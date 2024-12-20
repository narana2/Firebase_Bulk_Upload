# Firebase Bulk Upload Tool

A Node.js utility for bulk uploading structured resource data to Firebase Realtime Database. This tool is specifically designed to handle educational and support resources data, including contact information, websites, and resource categorization.

## Features

- Bulk upload JSON data to Firebase
- Handles multiple resource types (academic, financial, emergency, self-care)
- Supports various data fields (title, website, phone number, state, etc.)
- Maintains organized data structure in Firebase

## Prerequisites

Before you begin, ensure you have:
- Node.js installed on your system
- A Firebase project created in the [Firebase Console](https://console.firebase.google.com/)
- Firebase project credentials (serviceAccountKey.json)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/narana2/Firebase_Bulk_Upload.git
cd Firebase_Bulk_Upload
```

2. Install dependencies:
```bash
npm install
```

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Navigate to Project Settings > Service Accounts
4. Click "Generate New Private Key"
5. Save the downloaded file as `serviceAccountKey.json` in the project root directory

## Configuration

1. Place your `serviceAccountKey.json` in the project root directory
2. Ensure your `resources.json` file is properly formatted with your data:
```json
{
    "resources": {
        "RESOURCE_ID": {
            "Resource Type": "type",
            "state": "state",
            "title": "title",
            "website": "url",
            "phone number": "number"
        }
        // ... more resources
    }
}
```

## Usage

1. Prepare your data in the `resources.json` file following the structure above

2. Run the upload script:
```bash
node uploadData.js
```

3. The script will:
   - Connect to your Firebase project
   - Read the resources.json file
   - Upload all resources to your Firebase Realtime Database
   - Log the progress and any errors

## Data Structure

### Resource Types
- academic: Educational support services
- financial: Financial aid and support
- emergency: Emergency services and crisis support
- self care: Mental health and wellness resources

### Fields
- Resource Type: Category of the resource
- state: State where the resource is available
- title: Name of the resource
- website: URL of the resource (if available)
- phone number: Contact number (if available)
- email: Contact email (if available)

## Error Handling

The script includes error handling for:
- Invalid JSON format
- Firebase connection issues
- Data upload failures

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Security Notes

- Never commit your `serviceAccountKey.json` to version control
- Keep your Firebase credentials secure
- Follow Firebase security best practices

## License

This project is open source and available under the MIT License. 