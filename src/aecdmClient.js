import { query } from './graphqlClient.js';
import {
  ELEMENTS_BY_ELEMENT_GROUP,
  DIFF_ELEMENT_GROUP_BY_VERSION_WITH_LATEST,
  ELEMENT_GROUP_EXTRACTION_STATUS,
} from './queries.js';

export async function getElementsByElementGroup(elementGroupId, limit = 50, cursor = null) {
  const pagination = { limit };
  if (cursor) pagination.cursor = cursor;
  const data = await query(ELEMENTS_BY_ELEMENT_GROUP, {
    elementGroupId,
    pagination,
  });
  return data.elementsByElementGroup;
}

export async function getDiffAgainstLatest(elementGroupId, startVersion, versionType = 'PUBLISHED') {
  const data = await query(DIFF_ELEMENT_GROUP_BY_VERSION_WITH_LATEST, {
    elementGroupId,
    startVersion,
    versionFilter: { versionType },
  });
  return data.diffElementGroupByVersionWithLatest;
}

export async function getExtractionStatusPolling(fileUrn) {
  const data = await query(ELEMENT_GROUP_EXTRACTION_STATUS, { fileUrn });
  return data.elementGroupExtractionStatus;
}
