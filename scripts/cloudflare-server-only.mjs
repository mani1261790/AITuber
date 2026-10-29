/** Keep the deployed asset manifest and routing while updating Worker code. */
export function serverOnlyConfig(config) {
  if (config.name !== 'aituber' || config.account_id !== '2ea670c2a6ff28e248ef084adf095e8b' || config.assets?.binding !== 'ASSETS' || config.assets.run_worker_first !== true) {
    throw new Error('Server-only deploy requires the approved AITuber asset binding and worker-first routing.');
  }
  const {assets, ...rest} = structuredClone(config);
  const {directory: _directory, binding: _binding, ...routing} = assets;
  return {...rest, unsafe: {
    ...rest.unsafe,
    bindings: [...(rest.unsafe?.bindings ?? []), {name: assets.binding, type: 'assets'}],
    metadata: {...rest.unsafe?.metadata, keep_assets: true, assets: {config: routing}},
  }};
}
