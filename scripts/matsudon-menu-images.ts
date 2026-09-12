/** Exact menu-board names. The printed board shares one photo for all Taiyaki flavors. */
export const matsudonMenuImages = [
  { name: "Mie Goreng Ulang Tahun", category: "Noodle", file: "mie-goreng-ulang-tahun.webp" },
  { name: "Mie Goreng", category: "Noodle", file: "mie-goreng.webp" },
  { name: "Mie Kuah", category: "Noodle", file: "mie-kuah.webp" },
  { name: "Spicy Tamago Curry Rice", category: "Rice", file: "spicy-tamago-curry-rice.webp" },
  { name: "Spicy Tori Curry Rice", category: "Rice", file: "spicy-tori-curry-rice.webp" },
  { name: "Tamago Curry Rice", category: "Rice", file: "tamago-curry-rice.webp" },
  { name: "Tori Curry Rice", category: "Rice", file: "tori-curry-rice.webp" },
  { name: "Gepurekkuchiri Karage Don", category: "Rice", file: "gepurekkuchiri-karage-don.webp" },
  { name: "Teriyaki Karage Don", category: "Rice", file: "teriyaki-karage-don.webp" },
  { name: "Crispy Enoki", category: "Snack", file: "crispy-enoki.webp" },
  { name: "Taiyaki Coklat", category: "Snack", file: "taiyaki.webp" },
  { name: "Taiyaki Biscoff", category: "Snack", file: "taiyaki.webp" },
  { name: "Taiyaki Mix", category: "Snack", file: "taiyaki.webp" },
  { name: "French Fries", category: "Snack", file: "french-fries.webp" },
] as const;

export function matsudonImageUrl(name: string): string | null {
  const item = matsudonMenuImages.find((entry) => entry.name === name);
  return item ? `/images/menu/matsudon/${item.file}` : null;
}
