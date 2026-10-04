import { landingGroupBySlug } from '@/lib/landing/server';
import { rememberedGroupRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The group this browser last opened, for `/about`'s back bar (about-static). Never 4xx. */
export const GET = rememberedGroupRoute({ groupBySlug: landingGroupBySlug });
