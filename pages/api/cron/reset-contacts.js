// Reset contacts from "contacted" back to "new" after 4 days
import { serverSupabase } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = serverSupabase();

  try {
    // Get all contacts with status = 'contacted'
    const { data: contacted, error: fetchError } = await supabase
      .from('sc_contacts')
      .select('id, agency_name, updated_at')
      .eq('status', 'contacted');

    if (fetchError) throw fetchError;

    // Calculate 4 days ago in milliseconds
    const fourDaysAgo = Date.now() - (4 * 24 * 60 * 60 * 1000);

    // Find contacts that were contacted more than 4 days ago
    const toReset = contacted.filter(c => {
      const lastUpdate = new Date(c.updated_at).getTime();
      return lastUpdate < fourDaysAgo;
    });

    // Reset them back to 'new'
    if (toReset.length > 0) {
      const resetIds = toReset.map(c => c.id);
      const { error: updateError } = await supabase
        .from('sc_contacts')
        .update({ status: 'new', notes: 'Auto-reset after 4 days of no response' })
        .in('id', resetIds);

      if (updateError) throw updateError;
    }

    res.status(200).json({
      success: true,
      resetCount: toReset.length,
      resetAgencies: toReset.map(c => c.agency_name),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Reset contacts cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
