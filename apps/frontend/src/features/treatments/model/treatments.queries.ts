import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Species } from '@/features/animals/api/animals.api';
import { animalKeys } from '@/features/animals/model/animals.queries';
import { treatmentsApi, type StartTreatmentInput } from '../api/treatments.api';

export const treatmentKeys = {
  all: ['treatments'] as const,
  ofAnimal: (animalId: string) => ['treatments', 'animal', animalId] as const,
  recommendations: (species: Species) => ['treatments', 'recommendations', species] as const,
};

/** An animal's treatments, newest first (a few per animal: one page covers them). */
export function useAnimalTreatments(animalId: string) {
  return useQuery({
    queryKey: treatmentKeys.ofAnimal(animalId),
    queryFn: () => treatmentsApi.list({ animalId, limit: 100, sort: '-startedAt' }),
  });
}

/** Approved protocols for a species (the only ones a treatment may start from). */
export function useRecommendations(species: Species, enabled: boolean) {
  return useQuery({
    queryKey: treatmentKeys.recommendations(species),
    queryFn: () => treatmentsApi.recommendations({ species, limit: 100 }),
    enabled,
  });
}

function useInvalidateTreatments() {
  const queryClient = useQueryClient();
  // The animal page shows the withdrawal period the treatment sets.
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: treatmentKeys.all }),
      queryClient.invalidateQueries({ queryKey: animalKeys.all }),
    ]);
}

export function useStartTreatment() {
  const invalidate = useInvalidateTreatments();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: StartTreatmentInput; idempotencyKey: string }) =>
      treatmentsApi.start(body, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useFinishTreatment() {
  const invalidate = useInvalidateTreatments();
  return useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'complete' | 'cancel' }) =>
      outcome === 'complete' ? treatmentsApi.complete(id) : treatmentsApi.cancel(id),
    onSuccess: invalidate,
  });
}
