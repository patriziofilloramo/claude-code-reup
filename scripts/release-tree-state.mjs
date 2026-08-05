export function releaseTreeMutationError(initiallyDirty, currentPorcelain, stage) {
  if (initiallyDirty || currentPorcelain.trim().length === 0) return null
  return [
    `Release validation changed a previously clean working tree during ${stage}.`,
    'The npm tarball and source archive would no longer describe the same commit.',
    'Review the generated-file diff, commit it, and build the candidate again.',
  ].join('\n')
}
