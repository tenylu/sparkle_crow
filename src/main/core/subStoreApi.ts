import axios from 'axios'
import { subStorePort } from '../resolve/server'
import { getAppConfig } from '../config'

export async function subStoreSubs(): Promise<SubStoreSub[]> {
  const { useCustomSubStore = false, customSubStoreUrl = '' } = await getAppConfig()
  const baseUrl = useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${subStorePort}`
  const res = await axios.get(`${baseUrl}/api/subs`, { responseType: 'json', validateStatus: () => true })
  return res.data.data as SubStoreSub[]
}

export async function subStoreCollections(): Promise<SubStoreSub[]> {
  const { useCustomSubStore = false, customSubStoreUrl = '' } = await getAppConfig()
  const baseUrl = useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${subStorePort}`
  const res = await axios.get(`${baseUrl}/api/collections`, { responseType: 'json', validateStatus: () => true })
  return res.data.data as SubStoreSub[]
}
