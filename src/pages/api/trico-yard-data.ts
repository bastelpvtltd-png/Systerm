import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  
  const search = (req.query.search as string) || ''
  
  try {
    let query = supabase.from('trico_yard').select('*')
    
    if (search) {
      query = query.or(`container_no.ilike.%${search}%,shipper.ilike.%${search}%`)
    }
    
    // අලුත්ම දත්ත උඩින් පේන්න order කිරීම
    const { data, error } = await query.order('updated_at', { ascending: false })
    
    if (error) throw error
    return res.status(200).json({ items: data })
  } catch (error: any) {
    return res.status(200).json({ items: [], warning: error.message })
  }
}