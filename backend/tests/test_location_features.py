"""Test suite for Location-based marketplace features in Stitchly"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', os.environ.get('EXPO_BACKEND_URL', '')).rstrip('/')

class TestLocationEndpoints:
    """Test location-based endpoints"""

    def test_get_cities_endpoint(self, api_client):
        """Test GET /api/cities - returns available cities"""
        try:
            response = api_client.get(f"{BASE_URL}/api/cities")
            assert response.status_code == 200, f"Cities endpoint failed: {response.status_code}"
            data = response.json()
            assert isinstance(data, list), "Response should be a list"
            assert "Delhi" in data, "Delhi should be in cities list"
            assert "Mumbai" in data, "Mumbai should be in cities list"
            assert len(data) == 2, f"Expected 2 cities, got {len(data)}: {data}"
            print(f"✓ GET /api/cities passed: {data}")
        except Exception as e:
            print(f"✗ GET /api/cities failed: {str(e)}")
            raise

    def test_filter_tailors_by_city_mumbai(self, api_client):
        """Test GET /api/tailors?city=Mumbai - returns only Mumbai tailors"""
        try:
            response = api_client.get(f"{BASE_URL}/api/tailors?city=Mumbai")
            assert response.status_code == 200, f"Filter by Mumbai failed: {response.status_code}"
            data = response.json()
            assert isinstance(data, list), "Response should be a list"
            assert len(data) == 2, f"Expected 2 Mumbai tailors, got {len(data)}"
            
            # Verify all returned tailors are from Mumbai
            for tailor in data:
                assert tailor.get("city", "").lower() == "mumbai", f"Tailor {tailor['name']} is not from Mumbai: {tailor.get('city')}"
                assert "city" in tailor, "city field missing"
                assert "pincode" in tailor, "pincode field missing"
            
            print(f"✓ Mumbai filter passed: {len(data)} tailors - {[t['name'] for t in data]}")
        except Exception as e:
            print(f"✗ Mumbai filter failed: {str(e)}")
            raise

    def test_filter_tailors_by_city_delhi(self, api_client):
        """Test GET /api/tailors?city=Delhi - returns only Delhi tailors"""
        try:
            response = api_client.get(f"{BASE_URL}/api/tailors?city=Delhi")
            assert response.status_code == 200, f"Filter by Delhi failed: {response.status_code}"
            data = response.json()
            assert isinstance(data, list), "Response should be a list"
            assert len(data) == 1, f"Expected 1 Delhi tailor, got {len(data)}"
            
            # Verify tailor is from Delhi
            tailor = data[0]
            assert tailor.get("city", "").lower() == "delhi", f"Tailor is not from Delhi: {tailor.get('city')}"
            assert "city" in tailor, "city field missing"
            assert "pincode" in tailor, "pincode field missing"
            
            print(f"✓ Delhi filter passed: {len(data)} tailor - {data[0]['name']}")
        except Exception as e:
            print(f"✗ Delhi filter failed: {str(e)}")
            raise

    def test_list_all_tailors_no_city_filter(self, api_client):
        """Test GET /api/tailors (no city) - returns all tailors"""
        try:
            response = api_client.get(f"{BASE_URL}/api/tailors")
            assert response.status_code == 200, f"List all tailors failed: {response.status_code}"
            data = response.json()
            assert isinstance(data, list), "Response should be a list"
            assert len(data) == 3, f"Expected 3 total tailors, got {len(data)}"
            
            # Verify all have location fields
            for tailor in data:
                assert "city" in tailor, f"Tailor {tailor['name']} missing city field"
                assert "pincode" in tailor, f"Tailor {tailor['name']} missing pincode field"
                assert tailor["city"] in ["Mumbai", "Delhi"], f"Invalid city: {tailor['city']}"
            
            print(f"✓ List all tailors passed: {len(data)} tailors total")
        except Exception as e:
            print(f"✗ List all tailors failed: {str(e)}")
            raise


class TestLocationInRegistration:
    """Test location fields in user registration"""

    def test_register_with_location_fields(self, api_client):
        """Test POST /api/auth/register with city/pincode/address"""
        try:
            unique_email = f"test_location_{int(time.time())}@test.com"
            response = api_client.post(f"{BASE_URL}/api/auth/register", json={
                "name": "Test User With Location",
                "email": unique_email,
                "phone": "9876543210",
                "password": "test123",
                "role": "customer",
                "city": "Mumbai",
                "pincode": "400001",
                "address": "Test Address, Bandra West"
            })
            assert response.status_code == 200, f"Register with location failed: {response.status_code}"
            data = response.json()
            assert "token" in data, "Token missing in response"
            assert "user" in data, "User missing in response"
            
            user = data["user"]
            assert user["city"] == "Mumbai", f"City mismatch: {user.get('city')}"
            assert user["pincode"] == "400001", f"Pincode mismatch: {user.get('pincode')}"
            assert user["address"] == "Test Address, Bandra West", f"Address mismatch: {user.get('address')}"
            assert user["location"] == "Mumbai, 400001", f"Location auto-compute failed: {user.get('location')}"
            
            # Verify persistence with GET /api/auth/me
            token = data["token"]
            headers = {"Authorization": f"Bearer {token}"}
            me_response = api_client.get(f"{BASE_URL}/api/auth/me", headers=headers)
            assert me_response.status_code == 200
            me_data = me_response.json()
            assert me_data["city"] == "Mumbai"
            assert me_data["pincode"] == "400001"
            assert me_data["address"] == "Test Address, Bandra West"
            assert me_data["location"] == "Mumbai, 400001"
            
            print(f"✓ Register with location passed and verified: {user['city']}, {user['pincode']}")
        except Exception as e:
            print(f"✗ Register with location failed: {str(e)}")
            raise

    def test_get_auth_me_returns_location_fields(self, customer_token, api_client):
        """Test GET /api/auth/me returns city/pincode/address fields"""
        try:
            headers = {"Authorization": f"Bearer {customer_token}"}
            response = api_client.get(f"{BASE_URL}/api/auth/me", headers=headers)
            assert response.status_code == 200
            data = response.json()
            
            # Verify location fields exist
            assert "city" in data, "city field missing in auth/me"
            assert "pincode" in data, "pincode field missing in auth/me"
            assert "address" in data, "address field missing in auth/me"
            assert "location" in data, "location field missing in auth/me"
            
            # Anita customer should have Mumbai location
            assert data["city"] == "Mumbai", f"Expected Mumbai, got {data['city']}"
            assert data["pincode"] == "400001", f"Expected 400001, got {data['pincode']}"
            
            print(f"✓ GET /api/auth/me returns location fields: {data['city']}, {data['pincode']}")
        except Exception as e:
            print(f"✗ GET /api/auth/me location fields failed: {str(e)}")
            raise


class TestLocationInProfileUpdate:
    """Test location fields in profile update"""

    def test_update_profile_with_location(self, customer_token, api_client):
        """Test PUT /api/auth/profile updates city/pincode/address and auto-computes location"""
        try:
            headers = {"Authorization": f"Bearer {customer_token}"}
            
            # Update location
            response = api_client.put(f"{BASE_URL}/api/auth/profile", headers=headers, json={
                "city": "Delhi",
                "pincode": "110001",
                "address": "Updated Address, Connaught Place"
            })
            assert response.status_code == 200, f"Profile update failed: {response.status_code}"
            data = response.json()
            
            assert data["city"] == "Delhi", f"City not updated: {data.get('city')}"
            assert data["pincode"] == "110001", f"Pincode not updated: {data.get('pincode')}"
            assert data["address"] == "Updated Address, Connaught Place", f"Address not updated: {data.get('address')}"
            assert data["location"] == "Delhi, 110001", f"Location auto-compute failed: {data.get('location')}"
            
            # Verify persistence
            get_response = api_client.get(f"{BASE_URL}/api/auth/me", headers=headers)
            get_data = get_response.json()
            assert get_data["city"] == "Delhi"
            assert get_data["pincode"] == "110001"
            assert get_data["location"] == "Delhi, 110001"
            
            # Reset back to Mumbai for other tests
            api_client.put(f"{BASE_URL}/api/auth/profile", headers=headers, json={
                "city": "Mumbai",
                "pincode": "400001",
                "address": "123 Marine Drive, Mumbai"
            })
            
            print(f"✓ Profile update with location passed and verified")
        except Exception as e:
            print(f"✗ Profile update with location failed: {str(e)}")
            raise


class TestLocationBasedDeliveryAssignment:
    """Test city-based delivery partner assignment"""

    def test_delivery_partner_city_matching(self, customer_token, tailor_token, api_client):
        """Test order acceptance assigns delivery partner from same city"""
        try:
            # Create order with Mumbai customer to Mumbai tailor
            customer_headers = {"Authorization": f"Bearer {customer_token}"}
            
            # Get Mumbai tailors
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors?city=Mumbai")
            mumbai_tailors = tailors_response.json()
            assert len(mumbai_tailors) > 0, "No Mumbai tailors found"
            mumbai_tailor_id = mumbai_tailors[0]["id"]
            
            # Create order
            order_response = api_client.post(f"{BASE_URL}/api/orders", headers=customer_headers,json={
                "tailor_id": mumbai_tailor_id,
                "service_type": "Blouse Stitching",
                "description": "Test order for delivery assignment",
                "pickup_address": "123 Marine Drive, Mumbai",
                "pickup_location": {
                    "type": "Point",
                    "coordinates": [72.8777, 19.0760]
                },
                "payment_method": "cod",
                "delivery_option": {
                    "label": "Standard (5 Days)",
                    "days_required": 5
                }
            })
            assert order_response.status_code == 200
            order_id = order_response.json()["id"]
            
            # Accept order as tailor (this should assign delivery partner)
            tailor_headers = {"Authorization": f"Bearer {tailor_token}"}
            accept_response = api_client.put(f"{BASE_URL}/api/orders/{order_id}/accept", headers=tailor_headers)
            assert accept_response.status_code == 200
            
            accepted_order = accept_response.json()
            assert accepted_order["delivery_partner_id"], "No delivery partner assigned"
            delivery_partner_id = accepted_order["delivery_partner_id"]
            
            # Verify delivery partner is from Mumbai
            # Login as admin to check user details
            admin_login = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": "admin@stitchly.com",
                "password": "admin123"
            })
            admin_token = admin_login.json()["token"]
            admin_headers = {"Authorization": f"Bearer {admin_token}"}
            
            users_response = api_client.get(f"{BASE_URL}/api/admin/users?role=delivery", headers=admin_headers)
            delivery_partners = users_response.json()
            assigned_partner = next((d for d in delivery_partners if d["id"] == delivery_partner_id), None)
            
            assert assigned_partner, "Assigned delivery partner not found"
            # Note: City-based matching is case-insensitive, both Mumbai partners should work
            assert assigned_partner["city"].lower() == "mumbai", f"Delivery partner not from Mumbai: {assigned_partner.get('city')}"
            
            print(f"✓ Delivery partner city matching passed: {assigned_partner['name']} from {assigned_partner['city']}")
        except Exception as e:
            print(f"✗ Delivery partner city matching failed: {str(e)}")
            raise


class TestLocationDataIntegrity:
    """Test location data integrity across different user roles"""

    def test_tailor_detail_shows_location(self, api_client):
        """Test GET /api/tailors/{id} returns location fields"""
        try:
            # Get a tailor
            tailors_response = api_client.get(f"{BASE_URL}/api/tailors")
            tailors = tailors_response.json()
            tailor_id = tailors[0]["id"]
            
            # Get detail
            response = api_client.get(f"{BASE_URL}/api/tailors/{tailor_id}")
            assert response.status_code == 200
            data = response.json()
            
            assert "city" in data, "city missing in tailor detail"
            assert "pincode" in data, "pincode missing in tailor detail"
            assert "address" in data, "address missing in tailor detail"
            assert data["city"] in ["Mumbai", "Delhi"], f"Invalid city: {data['city']}"
            
            print(f"✓ Tailor detail location passed: {data['name']} at {data['city']}, {data['pincode']}")
        except Exception as e:
            print(f"✗ Tailor detail location failed: {str(e)}")
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
    """Get Mumbai customer auth token (anita@test.com)"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "anita@test.com",
        "password": "customer123"
    })
    if response.status_code != 200:
        pytest.skip("Could not login as customer")
    return response.json()["token"]

@pytest.fixture(scope="session")
def tailor_token(api_client):
    """Get Mumbai tailor auth token (ravi@stitchly.com)"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "ravi@stitchly.com",
        "password": "tailor123"
    })
    if response.status_code != 200:
        pytest.skip("Could not login as tailor")
    return response.json()["token"]
