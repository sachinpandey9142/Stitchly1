# Stitchly - Tailoring Marketplace PRD

## Overview
Stitchly is a 3-sided marketplace mobile + web application connecting Customers, Tailors, and Delivery Partners. Built with Expo (React Native), FastAPI backend, and MongoDB.

## Tech Stack
- **Frontend**: Expo Router (React Native), TypeScript
- **Backend**: FastAPI (Python)
- **Database**: MongoDB (local)
- **Auth**: JWT with bcrypt password hashing
- **Payment**: Razorpay (MOCKED)

## User Roles & Features

### Customer
- Browse nearby tailors with filters (specialty, rating, price)
- View tailor profiles with services, reviews, ratings
- Place orders with service selection, description, address
- Track order status through complete lifecycle
- Rate and review tailors after delivery
- Online payment (mock) or Cash on Delivery

### Tailor
- Dashboard with stats (new orders, active, completed, earnings)
- Accept/reject incoming orders
- Update order status (in_stitching → completed → ready)
- Manage services (add/delete with pricing)
- View earnings summary and request withdrawals
- Profile with specialities and working hours

### Delivery Partner
- View assigned deliveries
- Update delivery status (picked_up → delivered_to_tailor → collected → out_for_delivery → delivered)
- View earnings per delivery (₹50/delivery)

### Admin
- Analytics dashboard (users, orders, revenue, commission)
- User management (view, block/unblock, approve tailors)
- Order monitoring
- Commission settings (platform commission %)
- Withdrawal approval

## API Endpoints (all prefixed with /api)
- Auth: /auth/register, /auth/login, /auth/me, /auth/profile
- Tailors: /tailors, /tailors/{id}
- Orders: /orders, /orders/my, /orders/tailor, /orders/delivery, /orders/{id}/accept|reject|status
- Reviews: /reviews, /reviews/tailor/{id}
- Tailor Services: /tailor/services, /tailor/working-hours, /tailor/earnings, /tailor/withdraw
- Delivery: /delivery/assignments, /delivery/{id}/update, /delivery/earnings
- Admin: /admin/users, /admin/orders, /admin/analytics, /admin/settings, /admin/withdrawals
- Payment: /payment/create-order, /payment/verify (MOCK)
- Seed: /seed

## Seed Data Credentials
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@stitchly.com | admin123 |
| Tailor | ravi@stitchly.com | tailor123 |
| Tailor | priya@stitchly.com | tailor123 |
| Customer | anita@test.com | customer123 |
| Delivery | suresh@stitchly.com | delivery123 |

## Database Collections
- users, tailor_services, orders, reviews, settings, withdrawals

## Design
- Clean light theme with Deep Needle Green (#0F766E) primary
- Marigold (#D97706) accent for CTAs and ratings
- PlayfairDisplay headings, Manrope body text
- 8pt grid spacing system

## Status
- ✅ MVP Complete - All 4 role dashboards functional
- ✅ Location-Based Marketplace - City/Pincode filtering, city selector, location-based delivery assignment
- ✅ 21/21 backend API tests passed (iteration 1) + 9/9 location tests (iteration 2)
- ✅ Frontend flows tested and working
- 🔲 Payment: Razorpay MOCKED (needs real keys for production)
- 🔲 Future: Push notifications, coupon system, referral system
