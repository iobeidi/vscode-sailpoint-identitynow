import * as vscode from 'vscode';
import { BaseCSVExporter } from "../BaseExporter";
import { RolesTreeItem } from '../../models/IdentityNowTreeItem';
import { askFile } from '../../utils/vsCodeHelpers';
import { PathProposer } from '../../services/PathProposer';
import { RequestabilityForRole, Revocability, Role, RoleMembershipSelectorType, RolesApiListRolesRequest } from 'sailpoint-api-client';
import { GovernanceGroupIdToNameCacheService } from '../../services/cache/GovernanceGroupIdToNameCacheService';
import { CSV_MULTIVALUE_SEPARATOR } from '../../constants';
import { accessProfileApprovalSchemeToStringConverter, roleApprovalSchemeToStringConverter } from '../../utils/approvalSchemeConverter';
import { IdentityIdToNameCacheService } from '../../services/cache/IdentityIdToNameCacheService';
import { roleMembershipSelectorToStringConverter } from '../../parser/roleMembershipSelectorToStringConverter';
import { SourceIdToNameCacheService } from '../../services/cache/SourceIdToNameCacheService';
import { GenericAsyncIterableIterator } from '../../utils/GenericAsyncIterableIterator';

export class RoleExporterCommand {
    /**
     * Entry point 
     * @param node 
     * @returns 
     */
    async execute(node?: RolesTreeItem) {
        console.log("> RoleExporterCommand.execute");

        if (node === undefined) {
            console.error("WARNING: RoleExporterCommand: invalid item", node);
            throw new Error("RoleExporterCommand: invalid item");
        }

        const proposedPath = PathProposer.getRoleReportFilename(
            node.tenantName,
            node.tenantDisplayName
        );

        const filePath = await askFile(
            "Enter the file to save the CSV for role export",
            proposedPath
        );

        if (filePath === undefined) {
            return;
        }

        const exporter = new RoleExporter(
            node.tenantId,
            node.tenantName,
            node.tenantDisplayName,
            filePath
        );
        await exporter.exportFileWithProgression();
    }
}

/**
 * A Role as exported
 * @interface RoleDto
 */
export interface RoleDto {
    /**
     * The human-readable display name of the Role
     * @type {string}
     * @memberof Role
     */
    'name': string;

    /**
     * A human-readable description of the Role
     * @type {string}
     * @memberof Role
     */
    'description'?: string;
    /**
     *
     * @type {string}
     * @memberof Role
     */
    'owner': string | null;
    /**
     *
     * @type {Array<AccessProfileRef>}
     * @memberof Role
     */
    'accessProfiles'?: string;
    /**
     *
     * @type {RoleMembershipSelector}
     * @memberof Role
     */
    //'membership'?: RoleMembershipSelector | null;
    /**

    /**
     * Whether the Role is enabled or not.
     * @type {boolean}
     * @memberof Role
     */
    'enabled'?: boolean;
    /**
     * Whether the Role can be the target of access requests.
     * @type {boolean}
     * @memberof Role
     */
    'requestable'?: boolean;
    /**
     *
     * @type {RequestabilityForRole}
     * @memberof Role
     */
    'accessRequestConfig'?: RequestabilityForRole;
    /**
     *
     * @type {Revocability}
     * @memberof Role
     */
    'revocationRequestConfig'?: Revocability;

    /**
     * List describing the steps in approving the request
     */
    'approvalSchemes'?: string;

    /**
     * List describing the steps in approving the revocation request
     */
    'revokeApprovalSchemes'?: string;

    /**
     * String representation of the membership criteria
     */
    membershipCriteria?: string;

}

class RoleExporter extends BaseCSVExporter<Role> {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        path: string
    ) {
        super("roles",
            tenantId,
            tenantName,
            tenantDisplayName,
            '', // Base exported forces sourceId, but we do not need to use it in here, so leaving it blank.
            path);
    }

    protected async exportFile(task: any, token: vscode.CancellationToken): Promise<void> {
        console.log("> RoleExporter.exportFile");
        const headers = [
            "name",
            "description",
            "enabled",
            "requestable",
            "owner",
            "commentsRequired",
            "denialCommentsRequired",
            "approvalSchemes",
            "revokeCommentsRequired",
            "revokeDenialCommentsRequired",
            "revokeApprovalSchemes",
            "accessProfiles",
            "membershipCriteria"
        ];
        const paths = [
            "name",
            "description",
            "enabled",
            "requestable",
            "owner",
            "accessRequestConfig.commentsRequired",
            "accessRequestConfig.denialCommentsRequired",
            "approvalSchemes",
            "revocationRequestConfig.commentsRequired",
            "revocationRequestConfig.denialCommentsRequired",
            "revokeApprovalSchemes",
            "accessProfiles",
            "membershipCriteria"
        ];
        const unwindablePaths: string[] = [];

        const governanceGroupCache = new GovernanceGroupIdToNameCacheService(this.client);
        const identityCacheIdToName = new IdentityIdToNameCacheService(this.client);
        const sourceIdToNameCacheService = new SourceIdToNameCacheService(this.client);

        const iterator = new GenericAsyncIterableIterator<Role, RolesApiListRolesRequest>(
            this.client,
            this.client.getRoles);

        await this.writeData(headers, paths, unwindablePaths, iterator, task, token,
            async (item: Role): Promise<RoleDto> => {
                let membershipCriteria: string | undefined = undefined;
                if (item.membership !== undefined && item.membership !== null
                    && RoleMembershipSelectorType.Standard === item.membership.type
                ) {
                    membershipCriteria = await roleMembershipSelectorToStringConverter(
                        item.membership.criteria, sourceIdToNameCacheService);
                }

                const owner = item.owner ? (await identityCacheIdToName.get(item.owner.id!)) : null

                const itemDto: RoleDto = {
                    name: item.name,
                    // Escape carriage returns in description.
                    description: item.description?.replaceAll('\r', "\\r").replaceAll('\n', "\\n"),
                    enabled: item.enabled,
                    requestable: item.requestable,
                    owner: owner,
                    accessProfiles: item.accessProfiles?.map(x => x.name).join(CSV_MULTIVALUE_SEPARATOR),
                    accessRequestConfig: {
                        commentsRequired: item.accessRequestConfig?.commentsRequired ?? false,
                        denialCommentsRequired: item.accessRequestConfig?.denialCommentsRequired ?? false,
                    },
                    revocationRequestConfig: {
                        commentsRequired: item.revocationRequestConfig?.commentsRequired ?? false,
                        denialCommentsRequired: item.revocationRequestConfig?.denialCommentsRequired ?? false
                    },
                    approvalSchemes: await roleApprovalSchemeToStringConverter(
                        item.accessRequestConfig?.approvalSchemes,
                        governanceGroupCache),
                    // TODO cf. https://github.com/sailpoint-oss/developer.sailpoint.com/issues/413
                    revokeApprovalSchemes: await accessProfileApprovalSchemeToStringConverter(
                        item.revocationRequestConfig?.approvalSchemes,
                        governanceGroupCache),
                    membershipCriteria
                };

                return itemDto;
            });
        console.log("Governance Group Cache stats", governanceGroupCache.getStats());
        governanceGroupCache.flushAll();
        console.log("Identity Cache stats", identityCacheIdToName.getStats());
        identityCacheIdToName.flushAll();
        console.log("Source Cache stats", sourceIdToNameCacheService.getStats());
        sourceIdToNameCacheService.flushAll();
    }
}