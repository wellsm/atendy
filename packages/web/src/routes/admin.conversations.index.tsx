import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/conversations/')({
  component: () => (
    <p className="hidden p-8 text-sm text-muted md:block">
      Escolha uma conversa para ver as mensagens, as chamadas de IA e as ferramentas.
    </p>
  )
});
