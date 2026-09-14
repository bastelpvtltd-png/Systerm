import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  try {
    // 1. Trico Login විස්තර
    const username = 'TV' 
    const password = '1tv@' 

    // 2. Trico System එකට Login වීම සහ Session Cookies ලබා ගැනීම
    const loginUrl = 'https://s2.tricologi.net/webuser/login.php'  
    const loginData = new URLSearchParams()
    loginData.append('username', username)
    loginData.append('password', password)
    loginData.append('login', '1')

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginData.toString()
    })

    const cookies = loginResponse.headers.get('set-cookie') || ''

    // 3. Trico හි සැබෑ JSON දත්ත ලබාගන්නා URL එක වෙත Request කිරීම
    const dataUrl = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_load_json_ajax&req_type=raw'
    const dataResponse = await fetch(dataUrl, {
      headers: { 'Cookie': cookies }
    })
    
    const jsonText = await dataResponse.text()
    let rawData: any[] = []

    try {
      rawData = JSON.parse(jsonText)
    } catch (e) {
      throw new Error('Failed to parse JSON from Trico. Login might have failed or session expired.')
    }

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return res.status(200).json({ message: 'No containers found in yard from Trico.', fetched: 0 })
    }

    // 4. ලැබෙන JSON දත්ත අපේ Database Table එකට ගැළපෙන පරිදි සකස් කර ගැනීම
    const containers = rawData.map(item => ({
      veh_no: item.cont_vehno || '',
      container_no: item.cont_number || '',
      cusdec_no: item.cusdec_no || '',
      cdn: item.cdn_number || '',
      shipper: item.shipper_name || '',
      time_in: item.time_in || '',
      duration: item.duration || '',
      // Examination ('E') සහ Released ('R') තත්ත්වයන් එකට සකස් කිරීම
      status: item.released === 'R' ? 'R' : (item.examination === 'E' ? 'E' : ''),
      updated_at: new Date().toISOString()
    })).filter(c => c.container_no !== '') // Container number එක නැති හිස් පේළි ඉවත් කරයි

    if (containers.length === 0) {
       return res.status(200).json({ message: 'No valid containers found.', fetched: 0 })
    }

    // 5. Supabase වෙත දත්ත එකවර (Bulk Upsert) යැවීම
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