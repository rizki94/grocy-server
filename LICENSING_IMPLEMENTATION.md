# Licensing & Subscription System Implementation

## Overview
Comprehensive licensing and subscription management system for multi-tenant Grocy application with plan-based feature restrictions and resource limits.

## Features Implemented

### 1. **Database Schema**
- Added subscription fields to `accounts` table:
  - `plan`: Subscription tier (free, pro, enterprise)
  - `status`: Account status (active, expired, suspended)
  - `expiresAt`: Subscription expiration date
  - `maxBranches`: Maximum allowed branches
  - `maxUsers`: Maximum allowed users

### 2. **License Middleware**
- Validates account status and expiration on every request
- Exempts `super_admin` role from checks
- Attaches license info to request object for controllers
- Returns detailed error messages with account information
- Comprehensive logging for monitoring

### 3. **Plan-Based Features**
- Middleware to restrict features by plan
- Plan hierarchy: free < pro < enterprise
- Configurable limits per plan

### 4. **Resource Limit Enforcement**
- User creation checks against `maxUsers`
- Branch creation checks against `maxBranches`
- Detailed error messages with current usage

### 5. **Usage Tracking API**
Endpoint: `GET /api/usage`
Returns comprehensive account usage statistics including current usage, limits, and percentages.

### 6. **Account Management (Sysadmin)**
- List all accounts with pagination
- Edit account licenses
- Update plan, status, expiry, and limits

### 7. **Frontend Components**
- Account Usage Widget on dashboard
- Shows usage bars for users and branches
- Visual warnings when approaching limits
- Integrated into homepage

## Files Modified/Created

### Backend
- `src/middleware/license.ts`
- `src/middleware/plan-features.ts`
- `src/controllers/account.controller.ts`
- `src/controllers/usage.controller.ts`
- `src/controllers/user.controller.ts`
- `src/controllers/branch.controller.ts`
- `src/routes/account.route.ts`
- `src/routes/usage.route.ts`

### Frontend
- `src/hooks/use-account-usage.ts`
- `src/components/account-usage-widget.tsx`
- `src/components/ui/progress.tsx`
- `src/features/account/page.tsx`
- `src/features/account/form.tsx`
