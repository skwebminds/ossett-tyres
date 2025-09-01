# Ossett Tyres – Vehicle Registration & Tyre Ordering System

This project powers [ossettyres.co.uk](https://ossettyres.co.uk), a client website for a UK tyre garage.  
It integrates DVLA and OE Tyre Fitment APIs to provide a **registration lookup system** and automate the **tyre ordering process**.

---

## 🚗 Features

- **Vehicle Registration Lookup**  
  - Fetches vehicle details via DVLA API  
  - Retrieves OE tyre fitment data  

- **Tyre Ordering Widget**  
  - Frontend form for customers to select tyre sizes, quantity, brand, and budget range  
  - Manual override for tyre sizes if not found in database  

- **Order Automation**  
  - Orders are automatically logged into **Google Sheets** using the Google Sheets API & a GCP Service Account  
  - Customer order details are emailed to the garage using **Web3Forms API**  
  - Serverless backend deployed on **Vercel**  

---

## 🛠️ Tech Stack

- **Frontend**:  
  - HTML, CSS, JavaScript  

- **Backend**:  
  - Next.js (API Routes on Vercel)  
  - Node.js runtime  

- **Integrations**:  
  - DVLA Vehicle Enquiry API  
  - OE Tyre Fitment API  
  - Google Sheets API (via Service Account + JWT auth)  
  - Web3Forms API (email automation)  

- **Hosting**:  
  - Vercel (serverless backend + static frontend)

---

## 📊 Business Impact

- Handles **50+ monthly tyre enquiries** automatically  
- Eliminates manual logging by directly appending orders into Google Sheets  
- Reduced admin workload and sped up customer response times  
- Boosted garage’s digital presence with a reliable, automated order pipeline  

---

## 🚀 Setup & Installation

1. Clone the repo  
    ```bash
     git clone https://github.com/YOUR_USERNAME/ossett-tyres.git
     cd ossett-tyres


2. Install dependencies:
     ```bash
     npm install

3. Create a .env.local file with your API keys:

  - DVLA_API_KEY=your_dvla_key
  - WEB3FORMS_KEY=your_web3forms_key
  - GOOGLE_SA_EMAIL=service_account_email@project.iam.gserviceaccount.com
  - GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  - GOOGLE_SHEETS_ID=your_google_sheets_id

4. Deploy locally:

   - npm run dev

5. Deploy to Vercel

   - Push to GitHub
   - Connect repo to Vercel
   - Add the same environment variables in Vercel dashboard
