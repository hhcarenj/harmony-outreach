const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkMissingEmails() {
  const { data, error } = await supabase
    .from('sc_contacts')
    .select('id, agency_name, email, contact_name')
    .or('email.is.null,email.eq.');
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Found ${data.length} contacts with missing emails:\n`);
  data.forEach(c => {
    console.log(`- ${c.agency_name} (${c.contact_name || 'N/A'})`);
  });
}

checkMissingEmails();
