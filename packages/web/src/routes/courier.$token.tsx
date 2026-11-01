import { createFileRoute } from '@tanstack/react-router';

import { CourierPage } from '../components/staff/courier-page';

export const Route = createFileRoute('/courier/$token')({
  component: CourierRoute
});

function CourierRoute() {
  const { token } = Route.useParams();

  return <CourierPage token={token} />;
}
