// ================================================================
// LVI Data Collection Script (FINAL 25K-ROW VERSION)
// Sentinel-2 + GEDI Alignment for 3 Regions
// Group 2 DSE-A | Manipal Institute of Technology
// ================================================================
// HOW TO USE:
//   1. Go to https://code.earthengine.google.com
//   2. Paste this entire script and click Run
//   3. In the Tasks tab (top right), click Run for each export task
//   4. Files will appear in your Google Drive after 10-30 minutes
// ================================================================


// REGION DEFINITIONS (STANDARDIZED 1x1 DEGREE BOXES)
// Standardized 1x1 degree representative sample areas to prevent memory crashes
var westernGhats = ee.Geometry.Rectangle([74.5, 13.5, 75.5, 14.5]);
var blackForest = ee.Geometry.Rectangle([7.5, 47.7, 8.5, 48.7]);
var cerrado = ee.Geometry.Rectangle([-48.0, -14.0, -47.0, -13.0]);

var regions = {
    //Time expanded to 2.5 years (Mid 2020 to End 2022) to guarantee massive row counts
    'WesternGhats': { geom: westernGhats, start: '2020-06-01', end: '2022-12-31' },
    'BlackForest': { geom: blackForest, start: '2020-06-01', end: '2022-12-31' },
    'Cerrado': { geom: cerrado, start: '2020-06-01', end: '2022-12-31' }
};

//STEP 1 — LOAD AND PREPROCESS SENTINEL-2
function getS2(geometry, startDate, endDate) {

    var s2Clouds = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
        .filterBounds(geometry)
        .filterDate(startDate, endDate);

    var s2Sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)); //Strict 20% cloud filter

    var joined = ee.ImageCollection(ee.Join.saveFirst('cloud_mask').apply({
        primary: s2Sr,
        secondary: s2Clouds,
        condition: ee.Filter.equals({
            leftField: 'system:index',
            rightField: 'system:index'
        })
    }));

    var masked = joined.map(function (img) {
        var cloudProb = ee.Image(img.get('cloud_mask')).select('probability');
        var mask = cloudProb.lt(20);
        return img.updateMask(mask)
            .select(['B2', 'B3', 'B4', 'B8'])
            .divide(10000)
            .copyProperties(img, ['system:time_start']);
    });

    return masked.median().clip(geometry);
}

//STEP 2 — LOAD AND FILTER GEDI
function getGEDI(geometry, startDate, endDate) {

    var gedi = ee.ImageCollection('LARSE/GEDI/GEDI02_A_002_MONTHLY')
        .filterBounds(geometry)
        .filterDate(startDate, endDate)
        .select(['rh98', 'quality_flag', 'degrade_flag', 'urban_proportion']);

    var filtered = gedi.map(function (img) {
        var quality = img.select('quality_flag').eq(1);
        var degrade = img.select('degrade_flag').eq(0);
        var notUrban = img.select('urban_proportion').eq(0);
        var mask = quality.and(degrade).and(notUrban);

        var rh98 = img.select('rh98')
            .updateMask(mask)
            .clamp(0, 60);
        return rh98;
    });

    return filtered.mean().clip(geometry);
}

//STEP 3 — ALIGN AND SAMPLE (MEMORY OPTIMIZED)
function sampleRegion(regionName, geom, startDate, endDate) {

    print('Processing: ' + regionName);

    var s2 = getS2(geom, startDate, endDate);
    var gedi = getGEDI(geom, startDate, endDate);

    var stacked = s2.addBands(gedi.rename('rh98'));

    var samples = stacked.sample({
        region: geom,
        scale: 25,
        numPixels: 3000000,     //3 Million darts to catch the new 2.5-year tracks
        seed: 42,
        geometries: false,
        dropNulls: true,
        tileScale: 16           //forces Earth Engine to process in smaller chunks
    });

    samples = samples.map(function (f) {
        return f.set('region', regionName);
    });

    return samples;
}

//STEP 4 — RUN FOR ALL REGIONS AND EXPORT
var r = regions;

//--- Western Ghats ---
var samplesWG = sampleRegion(
    'WesternGhats',
    r['WesternGhats'].geom,
    r['WesternGhats'].start,
    r['WesternGhats'].end
);

Export.table.toDrive({
    collection: samplesWG,
    description: 'LVI_WesternGhats_Final',
    fileFormat: 'CSV',
    folder: 'LVI_Project',
    selectors: ['B2', 'B3', 'B4', 'B8', 'rh98', 'region']
});

//--- Black Forest ---
var samplesBF = sampleRegion(
    'BlackForest',
    r['BlackForest'].geom,
    r['BlackForest'].start,
    r['BlackForest'].end
);

Export.table.toDrive({
    collection: samplesBF,
    description: 'LVI_BlackForest_Final',
    fileFormat: 'CSV',
    folder: 'LVI_Project',
    selectors: ['B2', 'B3', 'B4', 'B8', 'rh98', 'region']
});

//--- Cerrado ---
var samplesCerrado = sampleRegion(
    'Cerrado',
    r['Cerrado'].geom,
    r['Cerrado'].start,
    r['Cerrado'].end
);

Export.table.toDrive({
    collection: samplesCerrado,
    description: 'LVI_Cerrado_Final',
    fileFormat: 'CSV',
    folder: 'LVI_Project',
    selectors: ['B2', 'B3', 'B4', 'B8', 'rh98', 'region']
});

//STEP 5 — MAP VISUALIZATION & VERIFICATION
//Visually verify the three bounding boxes on the global map
Map.addLayer(westernGhats, { color: 'red' }, 'Western Ghats Box');
Map.addLayer(blackForest, { color: 'blue' }, 'Black Forest Box');
Map.addLayer(cerrado, { color: 'orange' }, 'Cerrado Box');

//Zoom out to see the entire world
Map.setCenter(0, 20, 2);

print('Script loaded successfully');
print('Check the Tasks tab to start your 3 CSV exports');
