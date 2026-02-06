# Clean up ui

I dont like the placement of the "clear" buttons maybe they should be where the "text buttons" are?
or maybe it should just auto "clear" after deleting the feild input entirely?

~~also testing could "auto-test" after the api key is added.~~
DONE: All fields with test specs now auto-test on blur (both in SecretForm and initial deploy form).

~~the "test" button on the zotero api should be for both the library and the api key, therefore it should be after or it should "auto test" after the api key is added/updated~~
DONE: Auto-test triggers on blur for any field with a test spec, including dependent fields (e.g. Zotero API key tests with library ID).

## ~~Change color scheme~~

~~Change the color scheme to be more "academic" and less "techy". right now it has the same color scheme as porn hub which is not what i want.~~
DONE: Changed primary accent from blue to indigo, update badges from amber/orange to teal. More scholarly, less techy.

## ~~secret toggle glitches~~

~~the secret toggle glitches and chnages the color of the background to white under some cirumstances. respect the light/dark mode setting and dont make fields the wrong color~~
DONE: Added !important background-color enforcement, removed background-color from transitions, set root color-scheme to dark, and added autofill transition delay to prevent white flash on type toggle.
