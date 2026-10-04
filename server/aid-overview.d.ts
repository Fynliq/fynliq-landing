import type { AidOverview, AidGlance } from '../src/beta/preview';
type Fact = { field: string; label: string; value: string; period: string; estimated: boolean };
export declare function computeAidOverview(facts: Fact[]): AidOverview;
export declare function previewOf(overview: AidOverview, facts: Fact[]): { glance: AidGlance; reviewCount: number; figures: number };
