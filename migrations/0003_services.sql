-- Owner-editable services and prices. INSERT OR IGNORE so re-running never overwrites his edits.
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'services',
  '[{"name":"Oil change","price":"From $79","note":"Synthetic oil and a new filter."},{"name":"Brakes","price":"From $189","note":"New pads for one axle. Rotors extra if needed."},{"name":"Check engine light / diagnostics","price":"$99","note":"We find out why the light is on."},{"name":"Tires","price":"From $60","note":"Swap 4 tires that are already on rims."},{"name":"Battery","price":"From $169","note":"New battery, installed."}]'
);
