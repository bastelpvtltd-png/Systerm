import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    const username = 'TV' 
    const password = '1tv@' 

    // 1. Trico Login Request (Browser එකක් වගේම යැවීම)
    const loginUrl = 'https://s2.tricologi.net/webuser/login.php'  
    const loginData = new URLSearchParams()
    loginData.append('username', username)
    loginData.append('password', password)
    loginData.append('login', '1')

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      body: loginData.toString(),
      redirect: 'manual' // Cookie එක අනිවාර්යයෙන්ම අල්ලගන්න manual දාන්න ඕනේ
    })

    // Cookie එක හරියටම Extract කරගැනීම (Node.js Fetch වලට ගැළපෙන පරිදි)
    let cookies = ''
    if (loginResponse.headers.getSetCookie) {
      cookies = loginResponse.headers.getSetCookie().join('; ')
    } else {
      cookies = loginResponse.headers.get('set-cookie') || ''
    }

    // 2. Trico එකෙන් Data ඉල්ලීම (AJAX Request එකක් ලෙස පෙන්වීම)
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_load_json_ajax&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      method: 'GET',
      headers: { 
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest', // මේක ගොඩක් වැදගත් Trico එකට JSON එවන්න කියන්න
        'Referer': 'https://s2.tricologi.net/webuser/'
      }
    })
    
    const text = await dataResponse.text()

    // 3. ලැබුණේ JSON ද කියා පරීක්ෂා කිරීම
    if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) {
      return res.status(400).json({ 
        error: 'Trico server blocked the request or login failed.',
        debugHtml: text.slice(0, 300) 
      })
    }

    const rawData = JSON.parse(text)

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return res.status(200).json({ message: 'No containers found in yard from Trico.', fetched: 0 })
    }

    // 4. Data Map කිරීම
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

    if (containers.length === 0) {
       return res.status(200).json({ message: 'No valid containers found.', fetched: 0 })
    }

    // 5. Supabase වෙත Save කිරීම
    const { error: upsertError } = await supabase
      .from('trico_yard')
      .upsert(containers, { onConflict: 'container_no' })

    if (upsertError) throw upsertError

    return res.status(200).json({ 
      message: `Successfully synced. Total containers updated: ${containers.length}`, 
      fetched: containers.length 
    })

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Something went wrong during sync' })
  }
}