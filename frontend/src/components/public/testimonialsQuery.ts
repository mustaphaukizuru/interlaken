import { contentApi, type Testimonial } from '@/services/api';

/**
 * The published testimonials, one cache entry for every reader (Testimonials,
 * the home band, the admissions section, TemplatePage's paint hold).
 */
export const testimonialsQuery = {
  queryKey: ['testimonials'] as const,
  queryFn: async () => (await contentApi.getTestimonials()).data as Testimonial[],
  staleTime: 5 * 60_000,
  retry: false,
};
