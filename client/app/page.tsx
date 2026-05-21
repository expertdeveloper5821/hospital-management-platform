import { redirect } from 'next/navigation';

// Root — always redirect; auth guard in dashboard layout handles the split
export default function RootPage() {
  redirect('/dashboard');
}
