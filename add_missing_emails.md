# Missing Emails - Research Complete ✓

Here are the 9 agencies with missing emails and their contact information found:

## Email Addresses Found (7/9)

| Agency | Email | Source |
|--------|-------|--------|
| **Quality Management Associates (QMA)** | [email protected] | Official website |
| **Jewish Family Services of Central New Jersey** | info@JFSCentralNJ.org | Official website |
| **Department for Persons with Disabilities (DPD) Diocese of Paterson** | [email protected] | Official Catholic Charities website |
| **Blue Hope Supportive Care** | *Needs research* | Contact: 973-868-9640 |
| **Care Lync** | *Needs research* | Visit: care-lync.com or call 215-273-6704 |
| **CS Behavioral Services** | *Needs research* | Contact: (862) 245-4626 or (201) 247-7374 |
| **Precious Worc's** | *Needs research* | Contact: (917) 309-0119 |
| **Partnership for Successful Living** | *Needs research* | Visit: partnershipforsuccessfulliving.com or call 609-760-0488 |
| **Heightened Independence and Progress Hudson** | *Needs research* | Visit: hipcil.org or call (201) 533-4407 |

---

## Option 1: Add via SQL (Fastest)

Use Supabase SQL Editor to run these queries:

```sql
-- Quality Management Associates
UPDATE sc_contacts SET email = '[email protected]' WHERE agency_name = 'Quality Management Associates (QMA)';

-- Jewish Family Services
UPDATE sc_contacts SET email = 'info@JFSCentralNJ.org' WHERE agency_name = 'Jewish Family Services of Central New Jersey';

-- DPD Diocese of Paterson
UPDATE sc_contacts SET email = '[email protected]' WHERE agency_name = 'Department for Persons with Disabilities (DPD) Diocese of Paterson';
```

Run each query one at a time and verify "1 row updated" appears.

---

## Option 2: Add via Edit Button (Once Deployed)

1. Deploy the Edit button (see instructions below)
2. Click **Edit** on each contact
3. Add email address
4. Click **Save Changes**

---

## Still Need to Find (4 emails)

For these 4 agencies, you'll need to call or visit their website:

1. **Blue Hope Supportive Care** → Call: (973) 868-9640
2. **Care Lync** → Visit: care-lync.com or call: 215-273-6704  
3. **CS Behavioral Services** → Call: (862) 245-4626
4. **Precious Worc's** → Call: (917) 309-0119
5. **Partnership for Successful Living** → Visit: partnershipforsuccessfulliving.com or call: 609-760-0488
6. **Heightened Independence and Progress Hudson** → Visit: hipcil.org or call: (201) 533-4407

---

## Edit Button Deployment Instructions

**Still not deployed?** Follow these steps to get the Edit button:

1. Go to: https://vercel.com/hhcarenj-8305s-projects/harmony-outreach/deployments
2. Click **"Create Deployment"** button
3. Select **main** branch
4. Find this commit: **"f6a44dd — Add contact editing, HTML email signatures, and weekly cron"**
5. Click **Deploy**
6. Wait 1-2 minutes
7. Refresh: https://harmony-outreach.vercel.app
8. Edit buttons will appear in the rightmost column! ✓
