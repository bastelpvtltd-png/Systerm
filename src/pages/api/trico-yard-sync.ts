import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    // Trico හි සැබෑ JSON දත්ත ලබාගන්නා URL එක
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_load_json_ajax&req_type=raw'
    
    const response = await fetch(dataUrl, {
      method: 'GET',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv'
      },
      cache: 'no-store'
    })
    
    const text = await response.text()

    // ලැබුණේ JSON ද නැත්නම් Login page එකේ HTML එකද බලමු
    if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) {
      return res.status(400).json({ 
        error: 'Trico requires an active session cookie. Server returned login HTML page instead of JSON data.',
        snippet: text.slice(0, 150)
      })
    }

    const rawData = JSON.parse(text)

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return res.status(200).json({ message: 'No containers found in Trico yard.', fetched: 0 })
    }

    // Data Map කිරීම
    const containers = rawData.map((item: any) => ({
      veh_no: item.cont_vehno || '',
      container_no: item.cont_number || '',
      cusdec_no: item.cusdec_no || '',
      cdn: item.cdn_number || '',
      shipper: item.shipper_name || '',
      time_in: item.time_in || '',
      duration: item.duration || '',
      status: item.released === 'R' ? 'R' : (item.examination === 'E' ? 'E' : ''),
      updated_at: new Date().toISOString()
    })).filter((c: any) => c.container_no !== '')

    // Duplicate අයින් කිරීම (Container + Cusdec + CDN)
    const uniqueMap = new Map()
    containers.forEach(c => {
       const uniqueKey = `${c.container_no}-${c.cusdec_no}-${c.cdn}`
       if (!uniqueMap.has(uniqueKey)) uniqueMap.set(uniqueKey, c)
    })
    const uniqueContainers = Array.from(uniqueMap.values())

    // Supabase වෙත Save කිරීම
    const { error: upsertError } = await supabase
      .from('trico_yard')
      .upsert(uniqueContainers, { onConflict: 'container_no' })

    if (upsertError) throw upsertError

    return res.status(200).json({ 
      message: `Successfully synced. Total unique containers: ${uniqueContainers.length}`, 
      fetched: uniqueContainers.length 
    })

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Sync failed' })
  }
}