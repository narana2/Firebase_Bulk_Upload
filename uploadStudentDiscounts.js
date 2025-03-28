// Import Firebase Admin SDK
const admin = require("firebase-admin");

// Import service account credentials
const serviceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

// Student discounts data
const studentDiscounts = [
  {
    id: "amazon-prime",
    name: "Amazon Prime Student",
    description: "6-month free trial, then 50% off Prime membership",
    category: "Shopping",
    link: "https://www.amazon.com/Amazon-Student/b?node=668781011",
    requirements: "Valid .edu email address",
    discount: "50% off"
  },
  {
    id: "apple",
    name: "Apple Education",
    description: "Special pricing on Mac, iPad, and accessories",
    category: "Technology",
    link: "https://www.apple.com/us-edu/store",
    requirements: "Current student or accepted to college",
    discount: "Varies by product"
  },
  {
    id: "spotify-premium",
    name: "Spotify Premium Student",
    description: "Includes Hulu (ad-supported) and SHOWTIME",
    category: "Entertainment",
    link: "https://www.spotify.com/us/student/",
    requirements: "Enrolled at US Title IV accredited institution",
    discount: "$4.99/month"
  },
  {
    id: "microsoft-office",
    name: "Microsoft Office 365",
    description: "Free access to Office 365 Education",
    category: "Technology",
    link: "https://www.microsoft.com/en-us/education/products/office",
    requirements: "Valid school email address",
    discount: "100% off"
  },
  {
    id: "adobe-creative-cloud",
    name: "Adobe Creative Cloud",
    description: "60% off Creative Cloud All Apps plan",
    category: "Technology",
    link: "https://www.adobe.com/creativecloud/buy/students.html",
    requirements: "Proof of student status",
    discount: "60% off"
  },
  {
    id: "best-buy",
    name: "Best Buy Student Deals",
    description: "Exclusive student deals on tech",
    category: "Technology",
    link: "https://www.bestbuy.com/site/electronics/college-student-deals/pcmcat276200050000.c",
    requirements: "Student ID or .edu email",
    discount: "Varies by product"
  },
  {
    id: "youtube-premium",
    name: "YouTube Premium Student",
    description: "Discounted YouTube Premium subscription",
    category: "Entertainment",
    link: "https://www.youtube.com/premium/student",
    requirements: "Enrolled at higher education institution",
    discount: "$6.99/month"
  },
  {
    id: "nike",
    name: "Nike Student Discount",
    description: "10% off for students",
    category: "Shopping",
    link: "https://www.nike.com/help/a/student-discount",
    requirements: "Verified student status",
    discount: "10% off"
  },
  {
    id: "samsung",
    name: "Samsung Student Discount",
    description: "Up to 30% off for students",
    category: "Technology",
    link: "https://www.samsung.com/us/shop/discount-program/education/",
    requirements: "Valid .edu email address",
    discount: "Up to 30% off"
  },
  {
    id: "headspace",
    name: "Headspace Student Plan",
    description: "85% off annual subscription",
    category: "Health & Wellness",
    link: "https://www.headspace.com/studentplan",
    requirements: "Verified student status",
    discount: "85% off"
  }
];

// Function to upload discounts
async function uploadDiscounts() {
  try {
    console.log("Starting to upload student discounts...");
    
    const batch = db.batch();
    
    // Add each discount to the batch
    studentDiscounts.forEach((discount) => {
      const docRef = db.collection("studentDisc").doc(discount.id);
      batch.set(docRef, discount);
    });
    
    // Commit the batch
    await batch.commit();
    
    console.log("Successfully uploaded student discounts!");
    process.exit(0);
  } catch (error) {
    console.error("Error uploading discounts:", error);
    process.exit(1);
  }
}

// Run the upload
uploadDiscounts(); 