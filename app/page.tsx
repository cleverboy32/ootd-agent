import { GuestLanding } from '@/components/landing/GuestLanding';
import { creditSignupGrant } from '@/server/config/credits';

export default function MarketingPage() {
  return <GuestLanding signupGrant={creditSignupGrant()} />;
}
