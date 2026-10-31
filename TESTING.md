# How to test Zawli

## 1. Start it

Double-click **`Start Zawli.cmd`** in this folder.

- Two windows open: **Zawli database** and **Zawli app**. Keep both open while you test; close them to stop Zawli.
- The first start can take 5–10 minutes (it builds the app). Later starts take under a minute.
- Your browser opens the sign-in page at **http://localhost:3000**.
- After the code changes, use **`Rebuild and Start Zawli.cmd`** instead.

`localhost` only works on this computer. Phones use the "Phones on the same Wi-Fi" address printed by the launcher (for example `http://192.168.110.121:3000`). If Windows Firewall asks about Node.js, choose **Allow** on private networks.

## 2. Test accounts

All use the password **`ZawliDemo2026`**. They exist only on this computer.

| Sign in as                   | You can test                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `admin@zawli.test`           | Platform admin: create restaurants, plans, invoices, suspend/reactivate                 |
| `owner@kampala-grill.test`   | Restaurant owner: everything for Kampala Grill (menu, tables, staff, payments, reports) |
| `manager@kampala-grill.test` | Manager (no billing or restaurant settings)                                             |
| `waiter@kampala-grill.test`  | Waiter: floor screen, waiter calls, bills                                               |
| `kitchen@kampala-grill.test` | Kitchen screen only (no prices)                                                         |
| `owner@lakeside-cafe.test`   | A second restaurant — to check one restaurant can't see the other                       |

Tip: use a normal window for one account and a private/incognito window for another (for example owner + kitchen side by side).

Kampala Grill and Lakeside Café are fictional demo restaurants.

## 3. Try the main flow (about 10 minutes)

**a. Open the kitchen screen.** Sign in as `kitchen@kampala-grill.test` → you land on the kitchen display. Leave it open.

**b. Order as a guest — on your phone or a second browser window.**
Sign in (another window) as `owner@kampala-grill.test` → **Tables & QR codes** → scan a table's QR code with your phone, or click **Open menu** under a table.
Add something to the order → **View order** → **Continue to payment**.

**c. Pay first (mobile money).** On the payment screen pick **MTN MoMo** or **Airtel Money** and enter a number. Kampala Grill uses the **simulator** — no real money moves:

| Number ends in                                    | What happens                               |
| ------------------------------------------------- | ------------------------------------------ |
| anything else, e.g. `0772 123456` / `0752 123456` | Approved after about 5 seconds             |
| `000`, e.g. `0772 123000`                         | Declined — you can try again               |
| `999`, e.g. `0772 123999`                         | Never answered — shows how the timer works |

Watch the kitchen screen: **the order only appears after the payment is approved.** Unpaid orders never reach the kitchen and are cancelled when the timer runs out (15 minutes by default).

**d. Work the order.** On the kitchen screen: **Acknowledge → Start preparing → Mark ready**. The guest's phone shows "Your order is ready".

**e. Serve it.** Sign in as `waiter@kampala-grill.test` → **Floor** → **Served**.

**f. Check the numbers.** As the owner, open **Dashboard** and **Orders** → click the order to see the payment (MTN MoMo / Airtel Money, confirmed) and its full history.

## 4. Other things worth trying

- **Payment settings:** owner → **Restaurant settings → Mobile money payments.** Switch between "pay before the kitchen starts" and "pay at the restaurant", turn MTN/Airtel on or off, change the time limit.
- **Menu:** add a category and item with sizes and options; mark something sold out and see it greyed out for guests.
- **Staff:** invite a waiter — you get a one-time setup link to open in a private window.
- **Waiter calls / bill requests:** tap **Call waiter** or **Request bill** on the guest menu; they appear on the floor screen.
- **Printing:** Lakeside Café uses printed tickets — see **Print queue**.
- **New restaurant:** admin → **New restaurant**, then follow the owner's setup link and the go-live checklist.
- **Isolation:** signed in as the Lakeside owner, try opening a Kampala Grill page (e.g. `/app/kampala-grill/orders`) — you get "not found".

## 5. Known limits of this test setup

- Staff screens work in a browser **on this computer**. On phones/tablets over Wi-Fi, guest ordering works but staff sign-in doesn't — that needs a proper HTTPS server.
- Mobile money here is simulated. Real MTN MoMo / Airtel Money payments need each restaurant's own API keys from MTN / Airtel.
- No emails or SMS are sent; setup links are shown on screen to copy.
