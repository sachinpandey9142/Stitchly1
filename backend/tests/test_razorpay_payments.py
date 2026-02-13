"""Razorpay Payment Integration Tests - Real API calls"""
import pytest
import requests
import os
import hmac
import hashlib

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')

class TestRazorpayIntegration:
    """Test real Razorpay payment integration"""

    def test_create_razorpay_order(self, customer_token, api_client):
        """Test POST /api/payment/create-order - creates REAL Razorpay order with order_ prefix"""
        try:
            # Create a new order first
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
            tailors = tailors_response.json()
            tailor_id = tailors[0]["id"]
            
            headers = {"Authorization": f"Bearer {customer_token}"}
            order_response = api_client.post(f"{BASE_URL}/api/orders", headers=headers, json={
                "tailor_id": tailor_id,
                "service_type": "Blouse Stitching",
                "description": "Test payment integration",
                "pickup_address": "Test Address",
                "payment_method": "online"
            })
            assert order_response.status_code == 200
            order_id = order_response.json()["id"]
            
            # Create Razorpay payment order
            response = api_client.post(f"{BASE_URL}/api/payment/create-order", 
                headers=headers, 
                json={"order_id": order_id}
            )
            assert response.status_code == 200, f"Create payment order failed with {response.status_code}: {response.text}"
            data = response.json()
            
            # Validate response structure
            assert "razorpay_order_id" in data, "razorpay_order_id not in response"
            assert "razorpay_key_id" in data, "razorpay_key_id not in response"
            assert "amount" in data, "amount not in response"
            assert "currency" in data, "currency not in response"
            assert data["currency"] == "INR", f"Currency should be INR, got {data['currency']}"
            
            # Validate Razorpay order ID format (starts with order_)
            razorpay_order_id = data["razorpay_order_id"]
            assert razorpay_order_id.startswith("order_"), f"Razorpay order ID should start with 'order_', got {razorpay_order_id}"
            
            # Verify order updated in DB with razorpay_order_id
            order_response = api_client.get(f"{BASE_URL}/api/orders/{order_id}", headers=headers)
            assert order_response.status_code == 200
            order_data = order_response.json()
            assert order_data.get("razorpay_order_id") == razorpay_order_id, "Order not updated with razorpay_order_id"
            
            print(f"✓ Create Razorpay order test passed: {razorpay_order_id} (REAL order created)")
            return order_id, razorpay_order_id
        except Exception as e:
            print(f"✗ Create Razorpay order test failed: {str(e)}")
            raise

    def test_create_order_already_completed(self, customer_token, api_client):
        """Test POST /api/payment/create-order - returns 400 for already completed payment"""
        try:
            headers = {"Authorization": f"Bearer {customer_token}"}
            
            # Get customer orders and find a completed one
            orders_response = api_client.get(f"{BASE_URL}/api/orders/my", headers=headers)
            orders = orders_response.json()
            completed_order = next((o for o in orders if o.get("payment_status") == "completed"), None)
            
            if not completed_order:
                # Create and complete an order for testing
                tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
                tailor_id = tailors_response.json()[0]["id"]
                
                order_response = api_client.post(f"{BASE_URL}/api/orders", headers=headers, json={
                    "tailor_id": tailor_id,
                    "service_type": "Alteration",
                    "description": "Test completed payment",
                    "pickup_address": "Test",
                    "payment_method": "cod"
                })
                order_id = order_response.json()["id"]
                
                # Mark as delivered (auto-completes payment)
                api_client.put(f"{BASE_URL}/api/orders/{order_id}/status", 
                    headers=headers, 
                    json={"status": "delivered"}
                )
                completed_order = {"id": order_id}
            
            # Try to create payment order for completed order
            response = api_client.post(f"{BASE_URL}/api/payment/create-order", 
                headers=headers, 
                json={"order_id": completed_order["id"]}
            )
            assert response.status_code == 400, f"Should return 400 for completed order, got {response.status_code}"
            data = response.json()
            assert "already completed" in data.get("detail", "").lower(), "Error message should mention payment already completed"
            
            print(f"✓ Payment already completed test passed: Returns 400 with correct error message")
        except Exception as e:
            print(f"✗ Payment already completed test failed: {str(e)}")
            raise

    def test_verify_payment_invalid_signature(self, customer_token, api_client):
        """Test POST /api/payment/verify - rejects invalid signature with 400"""
        try:
            # Create order and payment order
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
            tailor_id = tailors_response.json()[0]["id"]
            
            headers = {"Authorization": f"Bearer {customer_token}"}
            order_response = api_client.post(f"{BASE_URL}/api/orders", headers=headers, json={
                "tailor_id": tailor_id,
                "service_type": "Test Service",
                "description": "Test",
                "pickup_address": "Test",
                "payment_method": "online"
            })
            order_id = order_response.json()["id"]
            
            payment_response = api_client.post(f"{BASE_URL}/api/payment/create-order", 
                headers=headers, 
                json={"order_id": order_id}
            )
            razorpay_order_id = payment_response.json()["razorpay_order_id"]
            
            # Try to verify with invalid signature
            response = api_client.post(f"{BASE_URL}/api/payment/verify", 
                headers=headers, 
                json={
                    "order_id": order_id,
                    "razorpay_payment_id": "pay_fake123",
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_signature": "invalid_signature_12345"
                }
            )
            assert response.status_code == 400, f"Should return 400 for invalid signature, got {response.status_code}"
            data = response.json()
            assert "verification failed" in data.get("detail", "").lower() or "invalid signature" in data.get("detail", "").lower(), "Error should mention verification failure"
            
            # Verify order payment_status is set to failed
            order_check = api_client.get(f"{BASE_URL}/api/orders/{order_id}", headers=headers)
            order_data = order_check.json()
            assert order_data.get("payment_status") == "failed", f"Payment status should be 'failed', got {order_data.get('payment_status')}"
            
            print(f"✓ Invalid signature test passed: Returns 400 and marks payment as failed")
        except Exception as e:
            print(f"✗ Invalid signature test failed: {str(e)}")
            raise

    def test_verify_payment_valid_signature(self, customer_token, api_client):
        """Test POST /api/payment/verify - valid HMAC returns verified:true and auto-calculates commission"""
        try:
            # Create order and payment order
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
            tailor_id = tailors_response.json()[0]["id"]
            
            headers = {"Authorization": f"Bearer {customer_token}"}
            order_response = api_client.post(f"{BASE_URL}/api/orders", headers=headers, json={
                "tailor_id": tailor_id,
                "service_type": "Blouse Stitching",
                "description": "Test valid signature",
                "pickup_address": "Test",
                "payment_method": "online"
            })
            order_id = order_response.json()["id"]
            order_price = order_response.json()["price"]
            
            payment_response = api_client.post(f"{BASE_URL}/api/payment/create-order", 
                headers=headers, 
                json={"order_id": order_id}
            )
            razorpay_order_id = payment_response.json()["razorpay_order_id"]
            
            # Generate valid HMAC signature
            razorpay_payment_id = "pay_test123"
            razorpay_key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "q7GGYb4RIuIu8YJ1gPHPNs6q")
            message = f"{razorpay_order_id}|{razorpay_payment_id}"
            valid_signature = hmac.new(
                razorpay_key_secret.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            # Verify payment with valid signature
            response = api_client.post(f"{BASE_URL}/api/payment/verify", 
                headers=headers, 
                json={
                    "order_id": order_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_signature": valid_signature
                }
            )
            assert response.status_code == 200, f"Valid signature should return 200, got {response.status_code}: {response.text}"
            data = response.json()
            
            # Verify response structure
            assert data.get("verified") == True, "verified should be True"
            assert "commission" in data, "commission not in response"
            assert "tailor_earnings" in data, "tailor_earnings not in response"
            assert "amount" in data, "amount not in response"
            
            # Verify commission calculation (default 10%)
            expected_commission = round(order_price * 10 / 100, 2)
            assert data["commission"] == expected_commission, f"Commission should be {expected_commission}, got {data['commission']}"
            expected_tailor_earnings = round(order_price - expected_commission, 2)
            assert data["tailor_earnings"] == expected_tailor_earnings, f"Tailor earnings should be {expected_tailor_earnings}, got {data['tailor_earnings']}"
            
            # Verify order updated in DB
            order_check = api_client.get(f"{BASE_URL}/api/orders/{order_id}", headers=headers)
            order_data = order_check.json()
            assert order_data.get("payment_status") == "completed", f"Payment status should be 'completed', got {order_data.get('payment_status')}"
            assert order_data.get("razorpay_payment_id") == razorpay_payment_id, "razorpay_payment_id not updated"
            assert order_data.get("commission_amount") == expected_commission, f"commission_amount not updated correctly"
            
            print(f"✓ Valid signature test passed: verified=True, commission={data['commission']}, tailor_earnings={data['tailor_earnings']}")
        except Exception as e:
            print(f"✗ Valid signature test failed: {str(e)}")
            raise

    def test_get_payment_status(self, customer_token, api_client):
        """Test GET /api/payment/status/{order_id} - returns payment status with razorpay fields"""
        try:
            headers = {"Authorization": f"Bearer {customer_token}"}
            
            # Get an order with payment info (use pre-created test order or create new)
            test_order_id = "20797dbb-8ba7-4a0a-a6d3-4af18de1e2ca"  # From review_request
            
            response = api_client.get(f"{BASE_URL}/api/payment/status/{test_order_id}", headers=headers)
            assert response.status_code == 200, f"Get payment status failed with {response.status_code}"
            data = response.json()
            
            # Verify response structure
            assert "order_id" in data, "order_id not in response"
            assert "payment_status" in data, "payment_status not in response"
            assert "payment_method" in data, "payment_method not in response"
            assert "razorpay_order_id" in data, "razorpay_order_id not in response"
            assert "razorpay_payment_id" in data, "razorpay_payment_id not in response"
            assert "amount" in data, "amount not in response"
            assert "commission_amount" in data, "commission_amount not in response"
            
            print(f"✓ Get payment status test passed: status={data['payment_status']}, razorpay_order_id={data.get('razorpay_order_id', 'N/A')}")
        except Exception as e:
            print(f"✗ Get payment status test failed: {str(e)}")
            raise

    def test_get_checkout_html(self, api_client):
        """Test GET /api/payment/checkout/{order_id} - returns HTML page with Razorpay checkout.js"""
        try:
            # Use pre-created test order
            test_order_id = "20797dbb-8ba7-4a0a-a6d3-4af18de1e2ca"
            
            response = api_client.get(f"{BASE_URL}/api/payment/checkout/{test_order_id}")
            assert response.status_code == 200, f"Get checkout HTML failed with {response.status_code}"
            
            # Verify response is HTML
            content_type = response.headers.get("content-type", "")
            assert "html" in content_type.lower(), f"Content-Type should be HTML, got {content_type}"
            
            html_content = response.text
            
            # Verify critical elements in HTML
            assert "<!DOCTYPE html>" in html_content or "<html>" in html_content, "Response should be valid HTML"
            assert "checkout.razorpay.com/v1/checkout.js" in html_content, "Razorpay checkout.js script not found"
            assert "Stitchly" in html_content, "Page should contain Stitchly branding"
            assert "rzp_test_" in html_content, "Razorpay test key not found"
            assert "openRazorpay" in html_content, "openRazorpay function not found"
            assert "new Razorpay" in html_content, "Razorpay initialization not found"
            
            print(f"✓ Get checkout HTML test passed: Valid HTML with Razorpay checkout.js")
        except Exception as e:
            print(f"✗ Get checkout HTML test failed: {str(e)}")
            raise

    def test_cod_order_no_razorpay(self, customer_token, api_client):
        """Test Order with payment_method=cod does NOT require Razorpay payment"""
        try:
            # Create COD order
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
            tailor_id = tailors_response.json()[0]["id"]
            
            headers = {"Authorization": f"Bearer {customer_token}"}
            order_response = api_client.post(f"{BASE_URL}/api/orders", headers=headers, json={
                "tailor_id": tailor_id,
                "service_type": "Alteration",
                "description": "COD test order",
                "pickup_address": "Test Address",
                "payment_method": "cod"
            })
            assert order_response.status_code == 200
            order_data = order_response.json()
            
            # Verify payment status is 'cod' not 'pending'
            assert order_data.get("payment_status") == "cod", f"COD order should have payment_status='cod', got {order_data.get('payment_status')}"
            assert order_data.get("payment_method") == "cod", "payment_method should be 'cod'"
            
            # Verify no razorpay fields
            assert not order_data.get("razorpay_order_id"), "COD order should not have razorpay_order_id"
            
            # Try to create payment order for COD (should fail or be unnecessary)
            # This is testing that COD orders don't need Razorpay flow
            print(f"✓ COD order test passed: payment_status='cod', no Razorpay required")
        except Exception as e:
            print(f"✗ COD order test failed: {str(e)}")
            raise


# ============ FIXTURES ============

@pytest.fixture(scope="session")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="session")
def customer_token(api_client):
    """Get customer auth token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "anita@test.com",
        "password": "customer123"
    })
    if response.status_code != 200:
        pytest.skip("Could not login as customer")
    return response.json()["token"]
