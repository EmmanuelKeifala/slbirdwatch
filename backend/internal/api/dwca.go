package api

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"
)

// ADM-08: the GBIF sharing pipeline. GBIF harvests a Darwin Core Archive from a public URL: occurrence.txt (the
// ADM-07 rows, open-licence records only), meta.xml (which Darwin Core term each column is) and eml.xml
// (dataset metadata). Rebuilt at most daily (Redis). Registering the URL with GBIF is a one-time manual step by
// the publishing organisation (see docs/gbif-publishing.md).

var dwcTerms = map[string]string{
	"license": "http://purl.org/dc/terms/license", "rightsHolder": "http://purl.org/dc/terms/rightsHolder",
	"modified": "http://purl.org/dc/terms/modified",
}

func dwcTerm(col string) string {
	if t, ok := dwcTerms[col]; ok {
		return t
	}
	return "http://rs.tdwg.org/dwc/terms/" + col
}

// buildDwCA returns the zipped archive and how many records it holds.
func (a *Server) buildDwCA(r *http.Request) ([]byte, int, error) {
	var occ bytes.Buffer
	tw := csv.NewWriter(&occ)
	tw.Comma = '\t'
	tw.Write(dwcColumns)
	n, nc, by := 0, false, false
	licenceCol := 0
	for i, c := range dwcColumns {
		if c == "license" {
			licenceCol = i
		}
	}
	if err := a.occurrences(r, true, func(rec []string) {
		tw.Write(rec)
		n++
		nc = nc || strings.Contains(rec[licenceCol], "by-nc")
		by = by || strings.Contains(rec[licenceCol], "/by/")
	}); err != nil {
		return nil, 0, err
	}
	tw.Flush()
	// the dataset carries the most restrictive licence among its records (each record keeps its own)
	licence, licenceName := "http://creativecommons.org/publicdomain/zero/1.0/legalcode", "Public Domain (CC0 1.0)"
	switch {
	case nc:
		licence, licenceName = "http://creativecommons.org/licenses/by-nc/4.0/legalcode", "Creative Commons Attribution Non Commercial (CC-BY-NC) 4.0 License"
	case by:
		licence, licenceName = "http://creativecommons.org/licenses/by/4.0/legalcode", "Creative Commons Attribution (CC-BY) 4.0 License"
	}

	var meta strings.Builder
	meta.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\t" linesTerminatedBy="\n" fieldsEnclosedBy="&quot;" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.txt</location></files>
    <id index="0"/>
`)
	for i, c := range dwcColumns {
		fmt.Fprintf(&meta, "    <field index=\"%d\" term=\"%s\"/>\n", i, dwcTerm(c))
	}
	meta.WriteString("  </core>\n</archive>\n")

	now := time.Now().UTC()
	eml := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.2.0" packageId="slbirdwatch-occurrences/%s" system="https://slbirdwatch.org" xml:lang="en">
  <dataset>
    <title xml:lang="en">SL Birdwatch: verified bird sightings from Sierra Leone</title>
    <creator><organizationName>SL Birdwatch</organizationName></creator>
    <metadataProvider><organizationName>SL Birdwatch</organizationName></metadataProvider>
    <pubDate>%s</pubDate>
    <language>en</language>
    <abstract><para>Bird sightings logged by the SL Birdwatch community in Sierra Leone and confirmed by a verifier (%d records). Locations of sensitive species, and of observers who hide their locations, are generalised to a grid cell; coordinateUncertaintyInMeters reflects this. Each record carries its observer's licence.</para></abstract>
    <intellectualRights><para>This work is licensed under a <ulink url="%s"><citetitle>%s</citetitle></ulink>.</para></intellectualRights>
    <coverage><geographicCoverage><geographicDescription>Sierra Leone</geographicDescription>
      <boundingCoordinates><westBoundingCoordinate>-13.35</westBoundingCoordinate><eastBoundingCoordinate>-10.25</eastBoundingCoordinate><northBoundingCoordinate>10.05</northBoundingCoordinate><southBoundingCoordinate>6.85</southBoundingCoordinate></boundingCoordinates>
    </geographicCoverage></coverage>
    <contact><organizationName>SL Birdwatch</organizationName></contact>
  </dataset>
</eml:eml>
`, now.Format("20060102"), now.Format("2006-01-02"), n, html.EscapeString(licence), html.EscapeString(licenceName))

	var z bytes.Buffer
	zw := zip.NewWriter(&z)
	for _, f := range []struct {
		name string
		data []byte
	}{{"occurrence.txt", occ.Bytes()}, {"meta.xml", []byte(meta.String())}, {"eml.xml", []byte(eml)}} {
		fw, err := zw.Create(f.name)
		if err != nil {
			return nil, 0, err
		}
		fw.Write(f.data)
	}
	if err := zw.Close(); err != nil {
		return nil, 0, err
	}
	return z.Bytes(), n, nil
}

// GET /gbif/dwca.zip — public, for GBIF's crawler.
func (a *Server) gbifArchive(w http.ResponseWriter, r *http.Request) {
	b, err := a.cache.Get(r.Context(), "gbif:dwca").Bytes()
	if err != nil {
		if b, _, err = a.buildDwCA(r); err != nil {
			internalError(w, "dwca", err)
			return
		}
		a.cache.Set(r.Context(), "gbif:dwca", b, 24*time.Hour)
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="slbirdwatch-dwca.zip"`)
	w.Write(b)
}
