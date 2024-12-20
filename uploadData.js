// Import Firebase Admin SDK
const admin = require("firebase-admin");
// Import service account credentials
const serviceAccount = require("./serviceAccountKey.json");
// Import your data to be uploaded
const data = require("./resources.json");

// Initialize Firebase Admin with your credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = admin.firestore();

// Function to upload data to Firestore
async function uploadData() {
  try {
    console.log("Uploading data to Firestore...");

    // Iterate through the resources in the data
    for (const [key, value] of Object.entries(data.resources)) {
      // Add each resource to Firestore under the "resourcesApp" collection
      await db.collection("resourcesApp").doc(key).set(value);
      console.log(`Uploaded ${key} successfully.`);
    }

    console.log("All data uploaded successfully!");
  } catch (error) {
    console.error("Error uploading data to Firestore:", error);
  }
}

// Call the function to upload data
uploadData();
