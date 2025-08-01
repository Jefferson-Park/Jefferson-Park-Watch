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
var format_StreetNames_1 = new ol.format.GeoJSON();
var features_StreetNames_1 = format_StreetNames_1.readFeatures(json_StreetNames_1, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_StreetNames_1 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_StreetNames_1.addFeatures(features_StreetNames_1);
var lyr_StreetNames_1 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_StreetNames_1, 
                style: style_StreetNames_1,
                popuplayertitle: 'Street Names',
                interactive: false,
                title: '<img src="styles/legend/StreetNames_1.png" /> Street Names'
            });
var format_SLOSW_2 = new ol.format.GeoJSON();
var features_SLOSW_2 = format_SLOSW_2.readFeatures(json_SLOSW_2, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_SLOSW_2 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_SLOSW_2.addFeatures(features_SLOSW_2);
var lyr_SLOSW_2 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_SLOSW_2, 
                style: style_SLOSW_2,
                popuplayertitle: 'SLO SW',
                interactive: true,
    title: 'SLO SW<br />\
    <img src="styles/legend/SLOSW_2_0.png" /> Acting SLO Cole #37623<br />\
    <img src="styles/legend/SLOSW_2_1.png" /> Acting SLO Gatus #40359<br />\
    <img src="styles/legend/SLOSW_2_2.png" /> SLO Ana Maria Mejia #33682/Acting SLO Chavez  #36761<br />\
    <img src="styles/legend/SLOSW_2_3.png" /> SLO John Biondo #36576 <br />\
    <img src="styles/legend/SLOSW_2_4.png" /> SLO Jose Saldana #36870<br />\
    <img src="styles/legend/SLOSW_2_5.png" /> SLO Kenneth Sanchez #37713<br />\
    <img src="styles/legend/SLOSW_2_6.png" /> SLO Paul Evleth #38086<br />\
    <img src="styles/legend/SLOSW_2_7.png" /> SLO Rickey Crowder #36763<br />\
    <img src="styles/legend/SLOSW_2_8.png" /> SLO Scott Landeros 41618<br />\
    <img src="styles/legend/SLOSW_2_9.png" /> SLO Tyler Whiteman #39471<br />' });
var format_Burglary_3 = new ol.format.GeoJSON();
var features_Burglary_3 = format_Burglary_3.readFeatures(json_Burglary_3, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Burglary_3 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Burglary_3.addFeatures(features_Burglary_3);
var lyr_Burglary_3 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Burglary_3, 
                style: style_Burglary_3,
                popuplayertitle: 'Burglary',
                interactive: true,
                title: '<img src="styles/legend/Burglary_3.png" /> Burglary'
            });
var format_GTA_4 = new ol.format.GeoJSON();
var features_GTA_4 = format_GTA_4.readFeatures(json_GTA_4, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_GTA_4 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_GTA_4.addFeatures(features_GTA_4);
var lyr_GTA_4 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_GTA_4, 
                style: style_GTA_4,
                popuplayertitle: 'GTA',
                interactive: true,
                title: '<img src="styles/legend/GTA_4.png" /> GTA'
            });
var format_Robbery_5 = new ol.format.GeoJSON();
var features_Robbery_5 = format_Robbery_5.readFeatures(json_Robbery_5, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Robbery_5 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Robbery_5.addFeatures(features_Robbery_5);
var lyr_Robbery_5 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Robbery_5, 
                style: style_Robbery_5,
                popuplayertitle: 'Robbery',
                interactive: true,
                title: '<img src="styles/legend/Robbery_5.png" /> Robbery'
            });
var format_ShotsFired_6 = new ol.format.GeoJSON();
var features_ShotsFired_6 = format_ShotsFired_6.readFeatures(json_ShotsFired_6, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_ShotsFired_6 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_ShotsFired_6.addFeatures(features_ShotsFired_6);
var lyr_ShotsFired_6 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_ShotsFired_6, 
                style: style_ShotsFired_6,
                popuplayertitle: 'Shots Fired',
                interactive: true,
                title: '<img src="styles/legend/ShotsFired_6.png" /> Shots Fired'
            });
var format_TFMV_7 = new ol.format.GeoJSON();
var features_TFMV_7 = format_TFMV_7.readFeatures(json_TFMV_7, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_TFMV_7 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_TFMV_7.addFeatures(features_TFMV_7);
var lyr_TFMV_7 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_TFMV_7, 
                style: style_TFMV_7,
                popuplayertitle: 'TFMV',
                interactive: true,
                title: '<img src="styles/legend/TFMV_7.png" /> TFMV'
            });
var format_Theft_8 = new ol.format.GeoJSON();
var features_Theft_8 = format_Theft_8.readFeatures(json_Theft_8, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Theft_8 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Theft_8.addFeatures(features_Theft_8);
var lyr_Theft_8 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Theft_8, 
                style: style_Theft_8,
                popuplayertitle: 'Theft',
                interactive: true,
                title: '<img src="styles/legend/Theft_8.png" /> Theft'
            });
var format_Vandalism_9 = new ol.format.GeoJSON();
var features_Vandalism_9 = format_Vandalism_9.readFeatures(json_Vandalism_9, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Vandalism_9 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Vandalism_9.addFeatures(features_Vandalism_9);
var lyr_Vandalism_9 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Vandalism_9, 
                style: style_Vandalism_9,
                popuplayertitle: 'Vandalism',
                interactive: true,
                title: '<img src="styles/legend/Vandalism_9.png" /> Vandalism'
            });
var format_AttemptedGTA_10 = new ol.format.GeoJSON();
var features_AttemptedGTA_10 = format_AttemptedGTA_10.readFeatures(json_AttemptedGTA_10, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_AttemptedGTA_10 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_AttemptedGTA_10.addFeatures(features_AttemptedGTA_10);
var lyr_AttemptedGTA_10 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_AttemptedGTA_10, 
                style: style_AttemptedGTA_10,
                popuplayertitle: 'Attempted GTA',
                interactive: true,
                title: '<img src="styles/legend/AttemptedGTA_10.png" /> Attempted GTA'
            });
var format_CriminalThreat_11 = new ol.format.GeoJSON();
var features_CriminalThreat_11 = format_CriminalThreat_11.readFeatures(json_CriminalThreat_11, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_CriminalThreat_11 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_CriminalThreat_11.addFeatures(features_CriminalThreat_11);
var lyr_CriminalThreat_11 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_CriminalThreat_11, 
                style: style_CriminalThreat_11,
                popuplayertitle: 'Criminal Threat',
                interactive: true,
                title: '<img src="styles/legend/CriminalThreat_11.png" /> Criminal Threat'
            });
var format_Battery_12 = new ol.format.GeoJSON();
var features_Battery_12 = format_Battery_12.readFeatures(json_Battery_12, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Battery_12 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Battery_12.addFeatures(features_Battery_12);
var lyr_Battery_12 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Battery_12, 
                style: style_Battery_12,
                popuplayertitle: 'Battery',
                interactive: true,
                title: '<img src="styles/legend/Battery_12.png" /> Battery'
            });
var format_BFMV_13 = new ol.format.GeoJSON();
var features_BFMV_13 = format_BFMV_13.readFeatures(json_BFMV_13, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_BFMV_13 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_BFMV_13.addFeatures(features_BFMV_13);
var lyr_BFMV_13 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_BFMV_13, 
                style: style_BFMV_13,
                popuplayertitle: 'BFMV',
                interactive: true,
                title: '<img src="styles/legend/BFMV_13.png" /> BFMV'
            });
var format_BTFV_14 = new ol.format.GeoJSON();
var features_BTFV_14 = format_BTFV_14.readFeatures(json_BTFV_14, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_BTFV_14 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_BTFV_14.addFeatures(features_BTFV_14);
var lyr_BTFV_14 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_BTFV_14, 
                style: style_BTFV_14,
                popuplayertitle: 'BTFV',
                interactive: true,
                title: '<img src="styles/legend/BTFV_14.png" /> BTFV'
            });
var format_AggravatedAssault_15 = new ol.format.GeoJSON();
var features_AggravatedAssault_15 = format_AggravatedAssault_15.readFeatures(json_AggravatedAssault_15, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_AggravatedAssault_15 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_AggravatedAssault_15.addFeatures(features_AggravatedAssault_15);
var lyr_AggravatedAssault_15 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_AggravatedAssault_15, 
                style: style_AggravatedAssault_15,
                popuplayertitle: 'Aggravated Assault',
                interactive: true,
                title: '<img src="styles/legend/AggravatedAssault_15.png" /> Aggravated Assault'
            });

lyr_OSMStandard_0.setVisible(true);lyr_StreetNames_1.setVisible(true);lyr_SLOSW_2.setVisible(true);lyr_Burglary_3.setVisible(true);lyr_GTA_4.setVisible(true);lyr_Robbery_5.setVisible(true);lyr_ShotsFired_6.setVisible(true);lyr_TFMV_7.setVisible(true);lyr_Theft_8.setVisible(true);lyr_Vandalism_9.setVisible(true);lyr_AttemptedGTA_10.setVisible(true);lyr_CriminalThreat_11.setVisible(true);lyr_Battery_12.setVisible(true);lyr_BFMV_13.setVisible(true);lyr_BTFV_14.setVisible(true);lyr_AggravatedAssault_15.setVisible(true);
var layersList = [lyr_OSMStandard_0,lyr_StreetNames_1,lyr_SLOSW_2,lyr_Burglary_3,lyr_GTA_4,lyr_Robbery_5,lyr_ShotsFired_6,lyr_TFMV_7,lyr_Theft_8,lyr_Vandalism_9,lyr_AttemptedGTA_10,lyr_CriminalThreat_11,lyr_Battery_12,lyr_BFMV_13,lyr_BTFV_14,lyr_AggravatedAssault_15];
lyr_StreetNames_1.set('fieldAliases', {'AutoID': 'AutoID', 'OBJECTID': 'OBJECTID', 'ASSETID': 'ASSETID', 'INT_ID_FROM': 'INT_ID_FROM', 'INT_ID_TO': 'INT_ID_TO', 'STNUM': 'STNUM', 'MAPSHEET': 'MAPSHEET', 'ID': 'ID', 'ADRF': 'ADRF', 'ADRT': 'ADRT', 'ZIP_R': 'ZIP_R', 'ADLF': 'ADLF', 'ADLT': 'ADLT', 'ZIP_L': 'ZIP_L', 'TDIR': 'TDIR', 'STNAME': 'STNAME', 'STSFX': 'STSFX', 'SFXDIR': 'SFXDIR', 'STNAME_A': 'STNAME_A', 'STSFX_A': 'STSFX_A', 'STATUS': 'STATUS', 'TEMP_': 'TEMP_', 'SECT_ID': 'SECT_ID', 'REMARKS': 'REMARKS', 'SV_STATUS': 'SV_STATUS', 'ST_SUBTYPE': 'ST_SUBTYPE', 'CRTN_DT': 'CRTN_DT', 'LST_MODF_DT': 'LST_MODF_DT', 'OLD_STREET_DESIGNATION': 'OLD_STREET_DESIGNATION', 'PLANNING_STREET_STANDARD': 'PLANNING_STREET_STANDARD', 'BSS_ST_CLASS': 'BSS_ST_CLASS', 'TOOLTIP': 'TOOLTIP', 'NLA_URL': 'NLA_URL', 'Planning_ASSETID': 'Planning_ASSETID', 'TYPE': 'TYPE', 'MODIFIED': 'MODIFIED', 'Street_Designation': 'Street_Designation', 'Street_Designation_WO_Mod': 'Street_Designation_WO_Mod', });
lyr_SLOSW_2.set('fieldAliases', {'OBJECTID': 'OBJECTID', 'RD': 'RD', 'OMEGA_NAME': 'OMEGA_NAME', 'Shape_Length': 'Shape_Length', 'Shape_Area': 'Shape_Area', 'SLO Name': 'SLO Name', 'email': 'email', 'Cell#': 'Cell#', 'CAR': 'CAR', });
lyr_Burglary_3.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_GTA_4.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_Robbery_5.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_ShotsFired_6.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_TFMV_7.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_Theft_8.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_Vandalism_9.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_AttemptedGTA_10.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_CriminalThreat_11.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_Battery_12.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_BFMV_13.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_BTFV_14.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_AggravatedAssault_15.set('fieldAliases', {'id': 'id', 'Crime': 'Crime', 'Address': 'Address', 'Zip': 'Zip', 'When': 'When', 'Date': 'Date', 'Time': 'Time', 'Descriptio': 'Descriptio', 'latlong': 'latlong', });
lyr_StreetNames_1.set('fieldImages', {'AutoID': 'Hidden', 'OBJECTID': 'Hidden', 'ASSETID': 'Hidden', 'INT_ID_FROM': 'Hidden', 'INT_ID_TO': 'Hidden', 'STNUM': 'Hidden', 'MAPSHEET': 'Hidden', 'ID': 'Hidden', 'ADRF': 'Hidden', 'ADRT': 'Hidden', 'ZIP_R': 'Hidden', 'ADLF': 'Hidden', 'ADLT': 'Hidden', 'ZIP_L': 'Hidden', 'TDIR': 'Hidden', 'STNAME': 'TextEdit', 'STSFX': 'RelationReference', 'SFXDIR': 'Hidden', 'STNAME_A': 'Hidden', 'STSFX_A': 'Hidden', 'STATUS': 'Hidden', 'TEMP_': 'Hidden', 'SECT_ID': 'Hidden', 'REMARKS': 'Hidden', 'SV_STATUS': 'Hidden', 'ST_SUBTYPE': 'Hidden', 'CRTN_DT': 'Hidden', 'LST_MODF_DT': 'Hidden', 'OLD_STREET_DESIGNATION': 'Hidden', 'PLANNING_STREET_STANDARD': 'Hidden', 'BSS_ST_CLASS': 'Hidden', 'TOOLTIP': 'Hidden', 'NLA_URL': 'Hidden', 'Planning_ASSETID': 'Hidden', 'TYPE': 'Hidden', 'MODIFIED': 'Hidden', 'Street_Designation': 'Hidden', 'Street_Designation_WO_Mod': 'Hidden', });
lyr_SLOSW_2.set('fieldImages', {'OBJECTID': 'Range', 'RD': 'TextEdit', 'OMEGA_NAME': 'TextEdit', 'Shape_Length': 'TextEdit', 'Shape_Area': 'TextEdit', 'SLO Name': 'TextEdit', 'email': 'TextEdit', 'Cell#': 'TextEdit', 'CAR': 'TextEdit', });
lyr_Burglary_3.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_GTA_4.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_Robbery_5.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_ShotsFired_6.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_TFMV_7.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_Theft_8.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_Vandalism_9.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_AttemptedGTA_10.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_CriminalThreat_11.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_Battery_12.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_BFMV_13.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_BTFV_14.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_AggravatedAssault_15.set('fieldImages', {'id': 'TextEdit', 'Crime': 'Classification', 'Address': 'TextEdit', 'Zip': 'TextEdit', 'When': 'Hidden', 'Date': 'DateTime', 'Time': 'DateTime', 'Descriptio': 'TextEdit', 'latlong': 'TextEdit', });
lyr_StreetNames_1.set('fieldLabels', {'STNAME': 'no label', 'STSFX': 'no label', });
lyr_SLOSW_2.set('fieldLabels', {'OBJECTID': 'hidden field', 'RD': 'no label', 'OMEGA_NAME': 'no label', 'Shape_Length': 'hidden field', 'Shape_Area': 'hidden field', 'SLO Name': 'no label', 'email': 'no label', 'Cell#': 'no label', 'CAR': 'no label', });
lyr_Burglary_3.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_GTA_4.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_Robbery_5.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_ShotsFired_6.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_TFMV_7.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_Theft_8.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_Vandalism_9.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_AttemptedGTA_10.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_CriminalThreat_11.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_Battery_12.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_BFMV_13.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_BTFV_14.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_AggravatedAssault_15.set('fieldLabels', {'id': 'hidden field', 'Crime': 'no label', 'Address': 'no label', 'Zip': 'no label', 'Date': 'no label', 'Time': 'no label', 'Descriptio': 'no label', 'latlong': 'hidden field', });
lyr_AggravatedAssault_15.on('precompose', function(evt) {
    evt.context.globalCompositeOperation = 'normal';
});