export const EXTRACTION_STATUS_BY_FILE_URN = `
subscription ($input: ElementGroupExtractionByFileUrnInput!) {
  elementGroupExtractionStatusByFileUrn(input: $input) {
    status
    details
    elementGroup {
      id
      name
      version {
        versionNumber
        wipVersionNumber
      }
    }
  }
}`;

export const EXTRACTION_STATUS_BY_PROJECT = `
subscription ($input: ElementGroupExtractionByProjectInput!) {
  elementGroupExtractionStatusByProject(input: $input) {
    status
    details
    elementGroup {
      id
      name
      alternativeIdentifiers {
        fileUrn
      }
      version {
        versionNumber
        wipVersionNumber
      }
    }
  }
}`;

export const ELEMENTS_BY_ELEMENT_GROUP = `
query ($elementGroupId: ID!, $pagination: PaginationInput) {
  elementsByElementGroup(elementGroupId: $elementGroupId, pagination: $pagination) {
    pagination {
      cursor
    }
    results {
      id
      name
      properties {
        results {
          name
          value
        }
      }
    }
  }
}`;

// Confirmed shape: unlike the subscription fields, this query takes fileUrn directly rather
// than a wrapped input type. Used as the polling-comparison baseline in the UI.
export const ELEMENT_GROUP_EXTRACTION_STATUS = `
query ($fileUrn: ID!) {
  elementGroupExtractionStatus(fileUrn: $fileUrn) {
    status
    details
    elementGroup {
      id
      name
      version {
        versionNumber
        wipVersionNumber
      }
    }
  }
}`;

// Confirmed shape (against the live schema and a working reference sample): the argument is
// `startVersion`, not `versionNumber`, and results nest under result[].differences.results[]
// rather than flat elementsAdded/elementsRemoved/elementsModified lists.
export const DIFF_ELEMENT_GROUP_BY_VERSION_WITH_LATEST = `
query ($elementGroupId: ID!, $startVersion: Int, $versionFilter: VersionFilterInput) {
  diffElementGroupByVersionWithLatest(elementGroupId: $elementGroupId, startVersion: $startVersion, versionFilter: $versionFilter) {
    pagination {
      cursor
    }
    result {
      type
      element {
        id
        name
        properties {
          results {
            name
            value
          }
        }
      }
      differences {
        pagination {
          cursor
        }
        results {
          type
          oldItem {
            name
            value
          }
          item {
            name
            value
          }
        }
      }
    }
  }
}`;
