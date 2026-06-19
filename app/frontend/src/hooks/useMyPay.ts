import { useQuery } from '@tanstack/react-query'
import { getMyPay, type MyPay } from '../services/api'

export function useMyPay() {
  return useQuery<MyPay>({
    queryKey: ['my-pay'],
    queryFn: getMyPay,
  })
}
