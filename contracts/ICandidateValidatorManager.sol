// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

interface ICandidateValidatorManager {
    /**
     * Method that StakeManager should call after stake updates.
     * @param validator Address of the validator owner.
     */
    function afterStakeUpdate(address validator) external;

    /**
     * Return all validators.
     * @param epoch Epoch number.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return owners List of validator owner addresses.
     * @return operators List of addresses for block signing.
     * @return actives List of activation status.
     * @return jailed List of jailing status.
     * @return stakes List of total staked amounts for each validator.
     * @return candidates List of whether new blocks can be produced.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getAll(
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            bool[] memory actives,
            bool[] memory jailed,
            uint256[] memory stakes,
            bool[] memory candidates,
            uint256 newCursor
        );

    /**
     * Return validators with the high stakes in the specific epoch.
     * @param epoch Current or future epoch number.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return owners List of validator owner addresses.
     * @return operators List of addresses for block signing.
     * @return actives List of activation status.
     * @return jailed List of jailing status.
     * @return stakes List of total staked amounts for each validator.
     * @return candidates List of whether new blocks can be produced.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getHighStakes(
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            bool[] memory actives,
            bool[] memory jailed,
            uint256[] memory stakes,
            bool[] memory candidates,
            uint256 newCursor
        );
}
