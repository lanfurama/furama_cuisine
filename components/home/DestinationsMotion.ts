import { EASE_INOUT, EASE_OUT, EASE_POP } from '@/lib/motion';

/*
 * "Our Destinations" coming into view (components/home/Destinations.tsx): one
 * journey. The dotted route draws left to right at an even pace; as it reaches
 * a stop, the stop lights up gold and the card beneath it opens downward, out
 * of the route, its photograph settling and its lines rising after it. Where
 * the route is not drawn (under 1140px, a rail of cards) the cards open one
 * after another on their own. Transforms, opacity and clip-path only, on the
 * section's own elements; with reduced motion the reveal never plays
 * (lib/motion.tsx), and everything is simply there.
 */

/** From one stop to the next along the route, and so from one card to the next. */
const STOP_MS = 380;
/** The cards' own pace where there is no route. */
const RAIL_STAGGER_MS = 90;

const CARD_OPEN: Keyframe[] = [{ clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }];
const PHOTO_SETTLE: Keyframe[] = [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }];
const LINE_RISE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(14px)' },
  { opacity: 1, transform: 'none' },
];

/** The stop: out of a small point, filled with its ring's gold as the route arrives, then back to its own centre. */
function stopLight(stop: HTMLElement): Keyframe[] {
  const { borderTopColor: gold, backgroundColor: centre } = getComputedStyle(stop);
  return [
    { opacity: 0, transform: 'scale(.5)', backgroundColor: gold },
    { opacity: 1, transform: 'none', backgroundColor: gold, offset: 0.35 },
    { opacity: 1, transform: 'none', backgroundColor: centre },
  ];
}

/** The section's reveal (a 'stage' choreography, lib/motion.tsx): its animations, from `delay` on. */
export function playDestinations(stage: HTMLElement, delay: number): Animation[] {
  const anims: Animation[] = [];
  const play = (el: Element | null, frames: Keyframe[], duration: number, at: number, easing: string) => {
    if (el) anims.push(el.animate(frames, { duration, delay: at, easing, fill: 'backwards' }));
  };

  const cards = [...stage.querySelectorAll<HTMLElement>('.dest-card')];
  const line = stage.querySelector<HTMLElement>('.journey-line');
  const stops = [...stage.querySelectorAll<HTMLElement>('.journey-dot')];
  // The route shows from 1140px (styles/home.css): hidden, it sets no pace.
  const routed = !!line && line.offsetParent !== null && cards.length > 1;
  const reach = (i: number) => delay + i * (routed ? STOP_MS : RAIL_STAGGER_MS);

  if (routed) {
    // From the first stop to the last, linear: it reaches stop i at reach(i).
    play(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], (cards.length - 1) * STOP_MS, delay, 'linear');
    stops.forEach((stop, i) => play(stop, stopLight(stop), 900, reach(i), EASE_POP));
  }

  cards.forEach((card, i) => {
    const at = reach(i);
    play(card, CARD_OPEN, 900, at, EASE_INOUT);
    play(card.querySelector('[data-reveal-zoom]'), PHOTO_SETTLE, 1500, at, EASE_OUT);
    play(card.querySelector('.dest-frame'), [{ opacity: 0 }, { opacity: 1 }], 600, at + 500, 'ease');
    // Its number, title and words once the card is half open; the count keeps its own hover behaviour.
    card.querySelectorAll('.dest-index,.dest-title,.dest-blurb').forEach((el, j) => play(el, LINE_RISE, 600, at + 380 + j * 70, EASE_OUT));
  });

  return anims;
}
