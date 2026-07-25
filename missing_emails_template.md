# Agencies Missing Email Addresses

Below are the 9 agencies that need email addresses added to your database. 

**Please research and add emails for these agencies:**

1. **Care Lync** - Phone: 215-273-6704
2. **CS Behavioral Services** - Phone: 201-247-7374  
3. **Quality Management Associates (QMA)** - Phone: 856-735-1015
4. **Precious Worc's** - Phone: 917-309-0119
5. **Department for Persons with Disabilities (DPD) Diocese of Paterson** - Need to research
6. **Partnership for Successful Living** - Phone: 609-760-0488
7. **Blue Hope Supportive Care** - Phone: 973-868-9640
8. **Jewish Family Services of Central New Jersey** - Phone: 908-352-8375
9. **Heightened Independence and Progress Hudson** - Phone: 201-533-4407

## How to Add Emails Once You Find Them

**Option 1: Use the Edit Button (after deployment)**
- Once the Edit button is deployed and working, click "Edit" on each contact
- Add the email address
- Click "Save Changes"

**Option 2: Manual Database Update (for right now)**
Use this SQL query in Supabase SQL Editor:
```sql
UPDATE sc_contacts 
SET email = 'email@example.com' 
WHERE agency_name = 'Agency Name Here';
```

**Option 3: Bulk Import via CSV**
If you have multiple emails to add, prepare a CSV and use the "Bulk Import" feature in the dashboard.

---

## Contact Audit Report
See `contact_audit.xlsx` for a complete list of all 168 agencies with email status.
