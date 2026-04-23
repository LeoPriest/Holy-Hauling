import { useNavigate, useParams } from 'react-router-dom'

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return (
    <div className="p-8">
      <button onClick={() => navigate('/')} className="text-blue-600 underline mb-4 block">← Back</button>
      <p className="text-gray-500">Command Center — lead {id} (coming soon)</p>
    </div>
  )
}
