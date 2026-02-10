module firewall::firewall {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::object::{Self, ID, UID};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    struct AdminCap has key, store {
        id: UID,
    }

    struct Vault has key, store {
        id: UID,
        balance: Balance<SUI>,
        admin_id: ID,
    }

    struct Permission has key, store {
        id: UID,
        agent: address,
        max_amount: u64,
        max_total: u64,
        spent_total: u64,
        expires_at_ms: u64,
        revoked: bool,
        vault_id: ID,
    }

    struct ActionProposal has key, store {
        id: UID,
        agent: address,
        recipient: address,
        amount: u64,
        created_at_ms: u64,
        executed: bool,
        permission_id: ID,
        vault_id: ID,
    }

    const E_NOT_AGENT: u64 = 0;
    const E_REVOKED: u64 = 1;
    const E_EXPIRED: u64 = 2;
    const E_AMOUNT: u64 = 3;
    const E_ALREADY_EXECUTED: u64 = 4;
    const E_PERMISSION_MISMATCH: u64 = 5;
    const E_VAULT_MISMATCH: u64 = 6;
    const E_QUOTA_EXCEEDED: u64 = 7;

    public entry fun create_admin(ctx: &mut TxContext) {
        let admin = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    public entry fun create_vault(admin: &AdminCap, ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            balance: balance::zero<SUI>(),
            admin_id: object::id(admin),
        };
        transfer::share_object(vault);
    }

    public entry fun deposit(vault: &mut Vault, coin: Coin<SUI>) {
        let bal = coin::into_balance(coin);
        balance::join(&mut vault.balance, bal);
    }

    public entry fun issue_permission(
        _admin: &AdminCap,
        vault: &Vault,
        agent: address,
        max_amount: u64,
        max_total: u64,
        expires_at_ms: u64,
        ctx: &mut TxContext,
    ) {
        assert!(object::id(_admin) == vault.admin_id, E_VAULT_MISMATCH);
        let permission = Permission {
            id: object::new(ctx),
            agent,
            max_amount,
            max_total,
            spent_total: 0,
            expires_at_ms,
            revoked: false,
            vault_id: object::id(vault),
        };
        transfer::transfer(permission, agent);
    }

    public entry fun revoke_permission(_admin: &AdminCap, permission: &mut Permission) {
        permission.revoked = true;
    }

    public entry fun propose_transfer(
        permission: &Permission,
        recipient: address,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == permission.agent, E_NOT_AGENT);

        let proposal = ActionProposal {
            id: object::new(ctx),
            agent: sender,
            recipient,
            amount,
            created_at_ms: clock::timestamp_ms(clock),
            executed: false,
            permission_id: object::id(permission),
            vault_id: permission.vault_id,
        };
        transfer::transfer(proposal, sender);
    }

    public entry fun execute_transfer(
        vault: &mut Vault,
        permission: &mut Permission,
        proposal: &mut ActionProposal,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == permission.agent, E_NOT_AGENT);
        assert!(sender == proposal.agent, E_NOT_AGENT);
        assert!(!permission.revoked, E_REVOKED);
        if (permission.expires_at_ms != 0) {
            assert!(clock::timestamp_ms(clock) <= permission.expires_at_ms, E_EXPIRED);
        };
        assert!(proposal.permission_id == object::id(permission), E_PERMISSION_MISMATCH);
        assert!(permission.vault_id == object::id(vault), E_VAULT_MISMATCH);
        assert!(proposal.vault_id == object::id(vault), E_VAULT_MISMATCH);
        assert!(!proposal.executed, E_ALREADY_EXECUTED);
        assert!(proposal.amount <= permission.max_amount, E_AMOUNT);
        if (permission.max_total != 0) {
            assert!(permission.max_total >= permission.spent_total, E_QUOTA_EXCEEDED);
            assert!(
                permission.max_total - permission.spent_total >= proposal.amount,
                E_QUOTA_EXCEEDED
            );
        };

        proposal.executed = true;
        permission.spent_total = permission.spent_total + proposal.amount;

        let bal = balance::split(&mut vault.balance, proposal.amount);
        let coin = coin::from_balance(bal, ctx);
        transfer::public_transfer(coin, proposal.recipient);
    }
}
