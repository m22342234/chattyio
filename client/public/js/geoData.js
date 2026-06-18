/**
 * Client-side geographic reference data for the country → region dropdown.
 * Countries with detailed subdivision data have their regions listed.
 * All others resolve to ['N/A'].
 */
const GEO_DATA = {
  'United States': [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
    'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
    'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
    'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
    'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
    'District of Columbia','Puerto Rico','Guam','U.S. Virgin Islands',
    'American Samoa','Northern Mariana Islands',
  ],
  'Canada': [
    'Alberta','British Columbia','Manitoba','New Brunswick',
    'Newfoundland and Labrador','Northwest Territories','Nova Scotia',
    'Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon',
  ],
  'United Kingdom': [
    'East Midlands','East of England','London','North East England',
    'North West England','Northern Ireland','Scotland','South East England',
    'South West England','Wales','West Midlands','Yorkshire and the Humber',
  ],
  'Australia': [
    'Australian Capital Territory','New South Wales','Northern Territory',
    'Queensland','South Australia','Tasmania','Victoria','Western Australia',
  ],
  'Germany': [
    'Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg',
    'Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia',
    'Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt',
    'Schleswig-Holstein','Thuringia',
  ],
  'France': [
    'Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Bretagne',
    'Centre-Val de Loire','Corse','Grand Est','Hauts-de-France',
    'Île-de-France','Normandie','Nouvelle-Aquitaine','Occitanie',
    "Pays de la Loire","Provence-Alpes-Côte d'Azur",
    'Guadeloupe','Martinique','Guyane','La Réunion','Mayotte',
  ],
  'Mexico': [
    'Aguascalientes','Baja California','Baja California Sur','Campeche',
    'Chiapas','Chihuahua','Ciudad de México','Coahuila','Colima','Durango',
    'Guanajuato','Guerrero','Hidalgo','Jalisco','México','Michoacán',
    'Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro',
    'Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco',
    'Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
  ],
  'Brazil': [
    'Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal',
    'Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul',
    'Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí',
    'Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia',
    'Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins',
  ],
  'India': [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
    'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
    'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
    'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu',
    'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    'Delhi','Jammu and Kashmir','Ladakh','Puducherry',
  ],
  'China': [
    'Anhui','Beijing','Chongqing','Fujian','Gansu','Guangdong','Guangxi',
    'Guizhou','Hainan','Hebei','Heilongjiang','Henan','Hong Kong','Hubei',
    'Hunan','Inner Mongolia','Jiangsu','Jiangxi','Jilin','Liaoning',
    'Macau','Ningxia','Qinghai','Shaanxi','Shandong','Shanghai','Shanxi',
    'Sichuan','Tianjin','Tibet','Xinjiang','Yunnan','Zhejiang',
  ],
  'Japan': [
    'Hokkaido','Tohoku','Kanto','Chubu','Kinki','Chugoku',
    'Shikoku','Kyushu','Okinawa',
  ],
  'South Korea': [
    'Seoul','Busan','Incheon','Daegu','Gwangju','Daejeon','Ulsan',
    'Sejong','Gyeonggi','Gangwon','North Chungcheong','South Chungcheong',
    'North Jeolla','South Jeolla','North Gyeongsang','South Gyeongsang','Jeju',
  ],
  'Italy': [
    'Abruzzo','Basilicata','Calabria','Campania','Emilia-Romagna',
    'Friuli Venezia Giulia','Lazio','Liguria','Lombardia','Marche',
    'Molise','Piemonte','Puglia','Sardegna','Sicilia','Toscana',
    'Trentino-Alto Adige','Umbria',"Valle d'Aosta",'Veneto',
  ],
  'Spain': [
    'Andalusia','Aragon','Asturias','Balearic Islands','Basque Country',
    'Canary Islands','Cantabria','Castilla-La Mancha','Castilla y León',
    'Catalonia','Ceuta','Extremadura','Galicia','La Rioja','Madrid',
    'Melilla','Murcia','Navarre','Valencia',
  ],
  'Netherlands': [
    'Drenthe','Flevoland','Friesland','Gelderland','Groningen','Limburg',
    'Noord-Brabant','Noord-Holland','Overijssel','Utrecht','Zeeland',
    'Zuid-Holland',
  ],
  'Poland': [
    'Greater Poland','Kuyavian-Pomeranian','Lesser Poland','Lodz',
    'Lower Silesian','Lublin','Lubusz','Masovian','Opole','Podkarpackie',
    'Podlaskie','Pomeranian','Silesian','Swietokrzyskie','Warmian-Masurian',
    'West Pomeranian',
  ],
  'Russia': [
    'Central','Northwestern','Southern','North Caucasian','Volga',
    'Ural','Siberian','Far Eastern',
  ],
  'South Africa': [
    'Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo',
    'Mpumalanga','North West','Northern Cape','Western Cape',
  ],
  'Argentina': [
    'Buenos Aires','Catamarca','Chaco','Chubut','Córdoba','Corrientes',
    'Entre Ríos','Formosa','Jujuy','La Pampa','La Rioja','Mendoza',
    'Misiones','Neuquén','Río Negro','Salta','San Juan','San Luis',
    'Santa Cruz','Santa Fe','Santiago del Estero','Tierra del Fuego',
    'Tucumán','Ciudad Autónoma de Buenos Aires',
  ],
  'Nigeria': [
    'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue',
    'Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT',
    'Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
    'Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
    'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
  ],
};

// Countries that map to a single generic region
const COUNTRIES_NO_REGIONS = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda',
  'Armenia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh',
  'Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia',
  'Bosnia and Herzegovina','Botswana','Brunei','Bulgaria','Burkina Faso',
  'Burundi','Cabo Verde','Cambodia','Cameroon','Central African Republic',
  'Chad','Chile','Colombia','Comoros','Congo','Costa Rica','Croatia',
  'Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica',
  'Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea',
  'Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','Gabon',
  'Gambia','Georgia','Ghana','Greece','Grenada','Guatemala','Guinea',
  'Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland',
  'Indonesia','Iran','Iraq','Ireland','Israel','Jamaica','Jordan',
  'Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan','Laos','Latvia',
  'Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania',
  'Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta',
  'Marshall Islands','Mauritania','Mauritius','Micronesia','Moldova',
  'Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
  'Namibia','Nauru','Nepal','New Zealand','Nicaragua','Niger','North Korea',
  'North Macedonia','Norway','Oman','Pakistan','Palau','Palestine',
  'Panama','Papua New Guinea','Paraguay','Peru','Philippines','Portugal',
  'Qatar','Romania','Rwanda','Saint Kitts and Nevis','Saint Lucia',
  'Saint Vincent and the Grenadines','Samoa','San Marino','São Tomé and Príncipe',
  'Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore',
  'Slovakia','Slovenia','Solomon Islands','Somalia','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania',
  'Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia',
  'Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates',
  'Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam',
  'Yemen','Zambia','Zimbabwe',
];

COUNTRIES_NO_REGIONS.forEach(c => { GEO_DATA[c] = ['N/A']; });

/** Sorted list of all country names for the first dropdown */
const COUNTRY_LIST = Object.keys(GEO_DATA).sort((a, b) => a.localeCompare(b));
