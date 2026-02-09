const fs = require("fs");
const path = require("path");
const file = path.resolve("C:/ParkingBuddies/client/src/pages/DashboardPage.tsx");
const data = fs.readFileSync(file, "utf8");
const index = data.lastIndexOf("Stripe payouts");
if (index === -1) {
    console.log("not found");
} else {
    const start = Math.max(0, index - 800);
    const end = Math.min(data.length, index + 4500);
    console.log(data.slice(start, end));
}
