// The real RecycleScroller is ESM-only and sizes rows from a viewport jsdom
// doesn't have; this stand-in renders every item through the slot.
export const RecycleScroller = {
  props: ['items'],
  template: '<div><template v-for="item in items" :key="item.id"><slot :item="item" /></template></div>'
};
