# Publishing SL Birdwatch sightings to GBIF (ADM-08)

The API serves a Darwin Core Archive at **`/gbif/dwca.zip`**. It is rebuilt at most once a day and holds:

- `occurrence.txt`: every verified, non-hidden sighting under an open licence (CC0, CC BY or CC BY-NC).
  - **Blurring:** sensitive species, and observers who hide their locations, are blurred to a grid cell, with a matching `coordinateUncertaintyInMeters`.
  - **Privacy:** private profiles appear as "SL Birdwatch observer N".
  - **Media:** photos and sounds marked "all rights reserved" are never linked.
- `meta.xml`: which Darwin Core term each column is.
- `eml.xml`: dataset metadata. The dataset licence is the most restrictive licence among the records it holds, and each record keeps its own licence.

GBIF harvests it from a public URL. Registering the dataset is a one-time manual step:

1. **Put the API on a public HTTPS address**, and set `PUBLIC_URL` so photo and sound links in the archive are absolute. Check that `https://<your-domain>/gbif/dwca.zip` downloads.
2. **Become a GBIF publisher.** Register the organisation that publishes the data at <https://www.gbif.org/become-a-publisher>. Your GBIF node must endorse it; for Sierra Leone, GBIF will route the request.
3. **Register the dataset** as an *Occurrence* dataset pointing at the archive URL. Do this through the GBIF registry: ask the helpdesk (<helpdesk@gbif.org>) to register a DwC-A endpoint, or use an IPT if the node provides one.
4. **Check the first crawl** on the dataset's GBIF page, and look at any interpretation issues it reports (for example, taxon names GBIF can't match).
5. **Keep it fresh.** GBIF re-crawls registered archives regularly, and the file is rebuilt daily, so there's nothing else to run.

Before registering, review `eml.xml` and change the contact to a real person or address. It currently names only "SL Birdwatch".
