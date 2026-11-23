# The icons

This folder is the only place the icons live. Nothing else in the repository holds icon artwork, and the page reaches the icons only through `index.ts` (the tests and the backend use `map.ts`, which loads no image).

| File | What it is |
|---|---|
| `atlas.png` | One image that holds every icon the page uses, each in its own 256-pixel cell |
| `atlas-map.json` | Where each icon sits in the image, its color and label, the release it came from and the page it came from |
| `map.ts` | Lookups over the map: the icon for a CloudFormation resource type, and a Block's lead color |
| `atlas.ts`, `IconSprite.tsx`, `index.ts` | The image for the page, an icon as a DOM sprite, and the one entry the page imports |

## Where they come from

The icons are the AWS Architecture Icons, release 07312026, from https://aws.amazon.com/architecture/icons/. Each one was drawn whole and unchanged into the atlas by a build step that isn't in this repository: no icon is recolored, cropped, flipped, rotated or reshaped, and the page never draws an icon of its own. The 3D scene uses no tone mapping, so each icon's colors reach the screen as they are in the file.

The icons belong to Amazon Web Services. The AWS Architecture Icons page above has the terms for using them. If you reuse this code, check those terms for your own use, or run without the icons as described below.

## Running without the icons

The page already handles a resource type that has no icon: its tile shows the name as text, the lists show no sprite, and a brick's lid keeps the builder's own color. So removing the icons is a change to this folder only:

1. Replace `atlas-map.json` with a map that has no entries: `{"release":"none","page":"","atlas":{"width":1,"height":1,"cell":1},"types":{}}`.
2. Replace `atlas.png` with any 1-pixel PNG.

With an empty map the typecheck and the build pass, and the footer drops its icon credit. Two tests check facts about this icon set and would need the same edit: "icons: the committed atlas is the image its map describes" in `test/e2e.test.ts` and "naming: in Generic mode no tile carries a service-level icon" in `test/connections.test.ts`. The 3D scene hasn't been checked in a browser with an empty map.
