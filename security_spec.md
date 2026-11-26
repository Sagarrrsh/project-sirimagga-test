# SIRIMAGGA Firestore Security Specification

## 1. Data Invariants
1. **Strict Manufacturer & Cost Isolation**: `manufacturers`, `order_procurement`, and `admin_settings` are strictly readable and writable ONLY by verified administrators (`isAdmin()`). Customers can never query or inspect manufacturer names, purchase prices, or profit calculations.
2. **Customer PII Protection**: `users/{userId}`, `users/{userId}/addresses/{addressId}`, and `users/{userId}/wishlist/{productId}` are strictly restricted to the owning verified user (`request.auth.uid == userId`) or an administrator.
3. **Order Ownership & State Integrity**: Customers may only create orders with `customerId == request.auth.uid`, initial status `'Order Placed'`, and server timestamps (`createdAt == request.time`, `updatedAt == request.time`). Customers may only read/list orders where `resource.data.customerId == request.auth.uid`. Customers cannot alter prices, payment status, or advance fulfillment stages.
4. **No Self-Assigned Admin Privilege**: `users/{userId}` forbids any `role` or `isAdmin` field. `admins/{userId}` writes are strictly restricted to existing verified admins (bootstrapped with `sanjugotur6@gmail.com`).
5. **Path ID & String Length Hardening**: All document IDs are validated against `^[a-zA-Z0-9_\-]+$` (max 128 chars) on single-document operations, and every string field has bounded `.size()` checks.
6. **Public Order Tracking Zero-PII & Anti-Enumeration**: `order_tracking/{trackingId}` is keyed by `trk_<sha256(orderNumber::email)>`, forbids `list` queries (`allow list: if false`), and contains zero customer PII (no name, email, phone, or street address).
7. **Email Notification Isolation**: `email_notifications/{notificationId}` only allows reads/lists where `resource.data.customerId == request.auth.uid` or `isAdmin()`, and only allows customers to log initial `'Order Placed'` or self-cancelled `'Cancelled'` events.
8. **Review Moderation & Visibility Isolation**: Authenticated customers can only submit product reviews with `status == 'pending'`, `isDemo == false`, `userId == request.auth.uid`, valid `productId`, and `createdAt == request.time`. Unapproved (`'pending'` / `'rejected'`) reviews are readable ONLY by the submitting customer or `isAdmin()`. Only `isAdmin()` may approve, reject, or delete reviews.

## 2. The "Dirty Dozen" Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated order creation**: `POST /orders/ord_1` with `request.auth == null`.
2. **Order impersonation**: Authenticated user A creates `/orders/ord_2` with `customerId: "user_B"`.
3. **Order status shortcutting by customer**: User A updates `/orders/ord_1` setting `status: "Shipped"` or `paymentStatus: "Paid"`.
4. **Shadow field injection on user profile**: User A creates `/users/user_A` adding `{ isAdmin: true }`.
5. **Cross-user PII read**: User A calls `get` on `/users/user_B` or `/users/user_B/addresses/addr_1`.
6. **Customer reading manufacturer directory**: User A calls `get` or `list` on `/manufacturers`.
7. **Customer reading internal procurement/profit ledger**: User A calls `get` or `list` on `/order_procurement`.
8. **Unverified email admin spoofing**: User with `email: "sanjugotur6@gmail.com"` and `email_verified: false` tries to write `/products/prod_1`.
9. **Blanket order list without customerId filter**: User A runs `list` on `/orders` without `where('customerId', '==', auth.uid)`.
10. **ID poisoning**: Authenticated user creates `/orders/../../admin_hack` or a 500-char document ID.
11. **Timestamp spoofing**: User A creates `/orders/ord_3` with a backdated `createdAt` instead of `request.time`.
12. **Catalog tampering & tracking enumeration**: Authenticated customer updates `/products/prod_1` setting `sellingPrice: 1`, or runs `list` on `/order_tracking`.
13. **Review moderation bypass**: Customer submits `/reviews/rev_1` with `status: "approved"`, or updates an existing review to `status: "approved"`, or unauthenticated user queries `/reviews` without `where('status', '==', 'approved')`.
