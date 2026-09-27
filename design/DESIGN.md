# Design Language

References (match these screen-for-screen): `design/refs/screen-onboarding.png`, `screen-discoveries.png`, `screen-detail.png` (overview: `indigo-discoveries.png`). **Light theme only.** The target users are modern, so keep it sleek: lots of whitespace, few elements per screen, consistent spacing. The earlier lime/pastel references are archived in `design/refs/superseded/`.

## Principles
1. **Calm white canvas, one bold ink.** Screens are white. Deep indigo is used for headlines, the primary button and the centre tab button.
2. **Periwinkle for "add" and "selected".** The add tile, selected chips and active states use periwinkle. Lavender tints are for soft icon circles.
3. **Pastel tiles hold the bird.** Every bird image sits on a soft pastel tile (lavender, mint, rose, cream, sky) inside a white rounded card. With no photo yet, a flat geometric bird illustration (`BirdArt`) stands in; never initials.
4. **Heavy headlines, quiet body.** Big, tight, extra-bold display type for names and questions; small grey body copy.
5. **Readable outdoors.** High contrast, tap targets of at least 48 px.

## Tokens

### Colour
| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#17144B` | `#F1F0FF` | Headlines, primary text, active icons |
| `inkMuted` | `#6E6C85` | `#A6A3C7` | Body copy, locations, captions |
| `bg` | `#FFFFFF` | `#0F0D2E` | Screen background |
| `surface` | `#FFFFFF` | `#1A1840` | Cards |
| `field` | `#F5F4FD` | `#211F4A` | Inputs, subtle fills |
| `border` | `#ECEAF6` | `#2B2856` | Card outlines, dividers |
| `primary` | `#17144B` | `#8E83F7` | Primary button fill, centre tab button |
| `onPrimary` | `#FFFFFF` | `#0F0D2E` | Text/icons on primary |
| `accent` | `#7C6FF2` | `#8E83F7` | Add tile, selected chip, count badge, links |
| `onAccent` | `#FFFFFF` | `#0F0D2E` | Text/icons on accent |
| `tint` | `#ECEAFD` | `#26235A` | Round icon buttons, avatar placeholder |
| `tiles` | lavender `#EEEDFC`, mint `#E4F5EE`, rose `#F4E5E7`, cream `#F4F0DA`, sky `#E3EEFA` | darker versions | Bird image backgrounds (picked by id) |
| `night` | `#120F45` → `#6D5BD8` → `#E7A6D6` | same | Onboarding / hero gradient |
| `correct` / `wrong` | `#2FA86B` / `#E5484D` | `#3CC17E` / `#F2555A` | Quiz feedback, errors |
| `rare` | `#F2A900` | same | Rarity / sensitive badge |

### Type
- **Display:** Bricolage Grotesque ExtraBold, tight line height (Display 40/42, Title 28/32, Heading 20/24).
- **Body:** Plus Jakarta Sans (Body 15/22, Label 13/18 semibold, Caption 12/16).
- Scientific names are always *italic*, `inkMuted`.

### Shape & spacing
- Radii: chip 12 · card 24 · tile 20 · button / nav / badge pill 999.
- Spacing on a 4 pt grid; screen side padding 20.
- Shadows: only a soft lavender glow under the tab bar and the add tile.

## Components
| Component | Spec |
|---|---|
| **Tab bar** | White bar with a top border. Line icons (Feather) in `inkMuted`, active icons in `ink`. A 64 px **navy circle in the centre** raised above the bar (add sighting now, record a call once audio lands). The profile tab shows the avatar. |
| **Screen header** | Back chevron on the left, centred title (Label, semibold), optional count badge (accent pill, white number), menu icon on the right. |
| **Primary button** | Navy pill, white text, 56 px. |
| **Secondary button** | Outlined pill, `border`, `ink` text. |
| **Add tile** | Periwinkle rounded rectangle (radius 24) with a white "+", sitting in the grid like a card. |
| **Bird card** | White card (radius 24, `border`), pastel tile with the image (or initials), bold centred name (2 lines max), grey location under it. Two-column staggered grid. |
| **Round icon button** | 48 px `tint` circle with an `accent` icon (play, map, gallery). |
| **Chip** | Outlined pill; selected = `accent` fill, white text. |
| **Species row** | Pastel circular tile (56 px) with initials or photo, bold name, italic scientific name, family caption. |

## Screen patterns
| Screen | Pattern |
|---|---|
| Onboarding | Night gradient, big white display headline ("Discover who's singing"), short copy, navy "Get started" pill. No login wall (ACC-01). |
| Library (home tab) | Header "Bird library"; **pinned** display heading + search field (stay put while scrolling); staggered bird-card grid. |
| Search (search tab) | **Pinned** heading + search field; results as bird cards. |
| My sightings (bookmark tab) | Header "Your discoveries" + count badge; two-column staggered bird cards; add tile first in the right column. |
| Species / sighting detail | Header with back + more; large bird on a pastel tile; round icon buttons stacked on the left (play call, map, gallery); huge display name. Below: swipeable pastel fact tiles, Listen, male vs female, swipeable "At a glance" cards, photos, month chart, map (tap for full screen), About, a gradient "Test yourself" card. Section titles in the display font. |
| Add sighting (centre button) | Modal: photos first, species picker, fields; navy "Save sighting". |
| Profile (avatar tab) | Night-gradient header card (avatar, name, role badge, area · level, bio, white "Edit profile" pill); pastel stat tiles; grouped rows with lavender icon circles; form on its own "Edit profile" screen. Signed out: gradient "Join the flock" card. |
| Status bar | White with dark icons (light icons only over the night gradient). |
