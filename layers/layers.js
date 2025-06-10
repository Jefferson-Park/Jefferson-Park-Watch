var wms_layers = [];


        var lyr_OSMStandard_0 = new ol.layer.Tile({
            'title': 'OSM Standard',
            'type':'base',
            'opacity': 1.000000,
            
            
            source: new ol.source.XYZ({
            attributions: ' &nbsp &middot; <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, CC-BY-SA</a>',
                url: 'http://tile.openstreetmap.org/{z}/{x}/{y}.png'
            })
        });
var format_SLOJurisdiction_1 = new ol.format.GeoJSON();
var features_SLOJurisdiction_1 = format_SLOJurisdiction_1.readFeatures(json_SLOJurisdiction_1, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_SLOJurisdiction_1 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_SLOJurisdiction_1.addFeatures(features_SLOJurisdiction_1);
var lyr_SLOJurisdiction_1 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_SLOJurisdiction_1, 
                style: style_SLOJurisdiction_1,
                popuplayertitle: 'SLO Jurisdiction',
                interactive: true,
    title: 'SLO Jurisdiction<br />\
    <img src="styles/legend/SLOJurisdiction_1_0.png" /> Ana Maria Mejia #33682<br />\
    <img src="styles/legend/SLOJurisdiction_1_1.png" /> John Bionndo #36576 / Cesar Lopez #38512 <br />\
    <img src="styles/legend/SLOJurisdiction_1_2.png" /> Jose Saldana #36870<br />\
    <img src="styles/legend/SLOJurisdiction_1_3.png" /> Kenneth Sanchez #37713<br />\
    <img src="styles/legend/SLOJurisdiction_1_4.png" /> Nichol Garner #32272<br />\
    <img src="styles/legend/SLOJurisdiction_1_5.png" /> Paul Evleth #38086<br />\
    <img src="styles/legend/SLOJurisdiction_1_6.png" /> Rickey Crowder #36763<br />\
    <img src="styles/legend/SLOJurisdiction_1_7.png" /> Sam Salazar #31256<br />\
    <img src="styles/legend/SLOJurisdiction_1_8.png" /> Scott Landeros 41618<br />\
    <img src="styles/legend/SLOJurisdiction_1_9.png" /> Tyler Whiteman #3947<br />\
    <img src="styles/legend/SLOJurisdiction_1_10.png" /> <br />' });
var format_StreetNames_2 = new ol.format.GeoJSON();
var features_StreetNames_2 = format_StreetNames_2.readFeatures(json_StreetNames_2, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_StreetNames_2 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_StreetNames_2.addFeatures(features_StreetNames_2);
var lyr_StreetNames_2 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_StreetNames_2, 
                style: style_StreetNames_2,
                popuplayertitle: 'Street Names',
                interactive: false,
                title: '<img src="styles/legend/StreetNames_2.png" /> Street Names'
            });
var format_CrimesReported20242025_3 = new ol.format.GeoJSON();
var features_CrimesReported20242025_3 = format_CrimesReported20242025_3.readFeatures(json_CrimesReported20242025_3, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_CrimesReported20242025_3 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_CrimesReported20242025_3.addFeatures(features_CrimesReported20242025_3);
var lyr_CrimesReported20242025_3 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_CrimesReported20242025_3, 
                style: style_CrimesReported20242025_3,
                popuplayertitle: 'Crimes Reported 2024-2025',
                interactive: true,
    title: 'Crimes Reported 2024-2025<br />\
    <img src="styles/legend/CrimesReported20242025_3_0.png" /> All Other Crimes<br />\
    <img src="styles/legend/CrimesReported20242025_3_1.png" /> Aggravated Assault<br />\
    <img src="styles/legend/CrimesReported20242025_3_2.png" /> Attempt GTA<br />\
    <img src="styles/legend/CrimesReported20242025_3_3.png" /> Battery<br />\
    <img src="styles/legend/CrimesReported20242025_3_4.png" /> BFMV<br />\
    <img src="styles/legend/CrimesReported20242025_3_5.png" /> BTFV<br />\
    <img src="styles/legend/CrimesReported20242025_3_6.png" /> Burglary<br />\
    <img src="styles/legend/CrimesReported20242025_3_7.png" /> Criminal Threat<br />\
    <img src="styles/legend/CrimesReported20242025_3_8.png" /> GTA<br />\
    <img src="styles/legend/CrimesReported20242025_3_9.png" /> Robbery<br />\
    <img src="styles/legend/CrimesReported20242025_3_10.png" /> TFMV<br />\
    <img src="styles/legend/CrimesReported20242025_3_11.png" /> Theft<br />\
    <img src="styles/legend/CrimesReported20242025_3_12.png" /> Theft from Vehicle<br />\
    <img src="styles/legend/CrimesReported20242025_3_13.png" /> Vandalism<br />' });

lyr_OSMStandard_0.setVisible(true);lyr_SLOJurisdiction_1.setVisible(true);lyr_StreetNames_2.setVisible(true);lyr_CrimesReported20242025_3.setVisible(true);
var layersList = [lyr_OSMStandard_0,lyr_SLOJurisdiction_1,lyr_StreetNames_2,lyr_CrimesReported20242025_3];
lyr_SLOJurisdiction_1.set('fieldAliases', {'OBJECTID': 'OBJECTID', 'RD': 'RD', 'OMEGA_NAME': 'OMEGA_NAME', 'Shape_Length': 'Shape_Length', 'Shape_Area': 'Shape_Area', 'SLO Name': 'SLO Name', 'email': 'email', 'Cell#': 'Cell#', });
lyr_StreetNames_2.set('fieldAliases', {'AutoID': 'AutoID', 'OBJECTID': 'OBJECTID', 'ASSETID': 'ASSETID', 'INT_ID_FROM': 'INT_ID_FROM', 'INT_ID_TO': 'INT_ID_TO', 'STNUM': 'STNUM', 'MAPSHEET': 'MAPSHEET', 'ID': 'ID', 'ADRF': 'ADRF', 'ADRT': 'ADRT', 'ZIP_R': 'ZIP_R', 'ADLF': 'ADLF', 'ADLT': 'ADLT', 'ZIP_L': 'ZIP_L', 'TDIR': 'TDIR', 'STNAME': 'STNAME', 'STSFX': 'STSFX', 'SFXDIR': 'SFXDIR', 'STNAME_A': 'STNAME_A', 'STSFX_A': 'STSFX_A', 'STATUS': 'STATUS', 'TEMP_': 'TEMP_', 'SECT_ID': 'SECT_ID', 'REMARKS': 'REMARKS', 'SV_STATUS': 'SV_STATUS', 'ST_SUBTYPE': 'ST_SUBTYPE', 'CRTN_DT': 'CRTN_DT', 'LST_MODF_DT': 'LST_MODF_DT', 'OLD_STREET_DESIGNATION': 'OLD_STREET_DESIGNATION', 'PLANNING_STREET_STANDARD': 'PLANNING_STREET_STANDARD', 'BSS_ST_CLASS': 'BSS_ST_CLASS', 'TOOLTIP': 'TOOLTIP', 'NLA_URL': 'NLA_URL', 'Planning_ASSETID': 'Planning_ASSETID', 'TYPE': 'TYPE', 'MODIFIED': 'MODIFIED', 'Street_Designation': 'Street_Designation', 'Street_Designation_WO_Mod': 'Street_Designation_WO_Mod', });
lyr_CrimesReported20242025_3.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_SLOJurisdiction_1.set('fieldImages', {'OBJECTID': 'Hidden', 'RD': 'Hidden', 'OMEGA_NAME': 'TextEdit', 'Shape_Length': 'Hidden', 'Shape_Area': 'Hidden', 'SLO Name': 'TextEdit', 'email': 'TextEdit', 'Cell#': 'TextEdit', });
lyr_StreetNames_2.set('fieldImages', {'AutoID': 'Hidden', 'OBJECTID': 'Hidden', 'ASSETID': 'Hidden', 'INT_ID_FROM': 'Hidden', 'INT_ID_TO': 'Hidden', 'STNUM': 'Hidden', 'MAPSHEET': 'Hidden', 'ID': 'Hidden', 'ADRF': 'Hidden', 'ADRT': 'Hidden', 'ZIP_R': 'Hidden', 'ADLF': 'Hidden', 'ADLT': 'Hidden', 'ZIP_L': 'Hidden', 'TDIR': 'Hidden', 'STNAME': 'TextEdit', 'STSFX': 'RelationReference', 'SFXDIR': 'Hidden', 'STNAME_A': 'Hidden', 'STSFX_A': 'Hidden', 'STATUS': 'Hidden', 'TEMP_': 'Hidden', 'SECT_ID': 'Hidden', 'REMARKS': 'Hidden', 'SV_STATUS': 'Hidden', 'ST_SUBTYPE': 'Hidden', 'CRTN_DT': 'Hidden', 'LST_MODF_DT': 'Hidden', 'OLD_STREET_DESIGNATION': 'Hidden', 'PLANNING_STREET_STANDARD': 'Hidden', 'BSS_ST_CLASS': 'Hidden', 'TOOLTIP': 'Hidden', 'NLA_URL': 'Hidden', 'Planning_ASSETID': 'Hidden', 'TYPE': 'Hidden', 'MODIFIED': 'Hidden', 'Street_Designation': 'Hidden', 'Street_Designation_WO_Mod': 'Hidden', });
lyr_CrimesReported20242025_3.set('fieldImages', {'id': 'TextEdit', 'Crime': 'TextEdit', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_SLOJurisdiction_1.set('fieldLabels', {'OMEGA_NAME': 'no label', 'SLO Name': 'no label', 'email': 'no label', 'Cell#': 'no label', });
lyr_StreetNames_2.set('fieldLabels', {'STNAME': 'no label', 'STSFX': 'no label', });
lyr_CrimesReported20242025_3.set('fieldLabels', {'id': 'hidden field', 'Crime': 'inline label - visible with data', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_CrimesReported20242025_3.on('precompose', function(evt) {
    evt.context.globalCompositeOperation = 'normal';
});