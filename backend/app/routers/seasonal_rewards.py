from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, desc, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from .. import models, schemas

router = APIRouter(prefix="/seasonal-rewards", tags=["seasonal-rewards"])


@router.get("/configs", response_model=list[schemas.SeasonalRewardConfigRead])
def list_seasonal_reward_configs(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return db.execute(select(models.SeasonalRewardConfig)).scalars().all()


@router.get("/configs/{config_id}", response_model=schemas.SeasonalRewardConfigRead)
def get_seasonal_reward_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    config = db.get(models.SeasonalRewardConfig, config_id)
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal reward config not found")
    return config


@router.post("/configs", response_model=schemas.SeasonalRewardConfigRead, status_code=status.HTTP_201_CREATED)
def create_seasonal_reward_config(
    payload: schemas.SeasonalRewardConfigCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    config = models.SeasonalRewardConfig(
        reward_type=payload.reward_type,
        name=payload.name,
        description=payload.description,
        points_required=payload.points_required,
        reward_value=payload.reward_value,
        max_recipients=payload.max_recipients,
        is_active=payload.is_active,
        auto_distribute=payload.auto_distribute,
        notification_enabled=payload.notification_enabled,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.patch("/configs/{config_id}", response_model=schemas.SeasonalRewardConfigRead)
def update_seasonal_reward_config(
    config_id: str,
    payload: schemas.SeasonalRewardConfigUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    config = db.get(models.SeasonalRewardConfig, config_id)
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal reward config not found")

    if payload.reward_type is not None:
        config.reward_type = payload.reward_type
    if payload.name is not None:
        config.name = payload.name
    if payload.description is not None:
        config.description = payload.description
    if payload.points_required is not None:
        config.points_required = payload.points_required
    if payload.reward_value is not None:
        config.reward_value = payload.reward_value
    if payload.max_recipients is not None:
        config.max_recipients = payload.max_recipients
    if payload.is_active is not None:
        config.is_active = payload.is_active
    if payload.auto_distribute is not None:
        config.auto_distribute = payload.auto_distribute
    if payload.notification_enabled is not None:
        config.notification_enabled = payload.notification_enabled

    db.commit()
    db.refresh(config)
    return config


@router.delete("/configs/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_seasonal_reward_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    config = db.get(models.SeasonalRewardConfig, config_id)
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal reward config not found")
    db.delete(config)
    db.commit()


@router.get("/distributions", response_model=list[schemas.RewardDistributionRead])
def list_reward_distributions(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return db.execute(select(models.RewardDistribution)).scalars().all()


@router.get("/distributions/{distribution_id}", response_model=schemas.RewardDistributionRead)
def get_reward_distribution(
    distribution_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    distribution = db.get(models.RewardDistribution, distribution_id)
    if not distribution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reward distribution not found")
    return distribution


@router.post("/distributions", response_model=schemas.RewardDistributionRead, status_code=status.HTTP_201_CREATED)
def create_reward_distribution(
    payload: schemas.RewardDistributionCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    distribution = models.RewardDistribution(
        season_id=payload.season_id,
        reward_type=payload.reward_type,
        period_start=payload.period_start,
        period_end=payload.period_end,
        total_recipients=payload.total_recipients,
        total_rewards=payload.total_rewards,
        status=payload.status,
        details=payload.details,
    )
    db.add(distribution)
    db.commit()
    db.refresh(distribution)
    return distribution


@router.patch("/distributions/{distribution_id}", response_model=schemas.RewardDistributionRead)
def update_reward_distribution(
    distribution_id: str,
    payload: schemas.RewardDistributionUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    distribution = db.get(models.RewardDistribution, distribution_id)
    if not distribution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reward distribution not found")

    if payload.season_id is not None:
        distribution.season_id = payload.season_id
    if payload.reward_type is not None:
        distribution.reward_type = payload.reward_type
    if payload.period_start is not None:
        distribution.period_start = payload.period_start
    if payload.period_end is not None:
        distribution.period_end = payload.period_end
    if payload.total_recipients is not None:
        distribution.total_recipients = payload.total_recipients
    if payload.total_rewards is not None:
        distribution.total_rewards = payload.total_rewards
    if payload.status is not None:
        distribution.status = payload.status
    if payload.details is not None:
        distribution.details = payload.details

    db.commit()
    db.refresh(distribution)
    return distribution


@router.delete("/distributions/{distribution_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reward_distribution(
    distribution_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    distribution = db.get(models.RewardDistribution, distribution_id)
    if not distribution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reward distribution not found")
    db.delete(distribution)
    db.commit()


@router.get("/leaderboard", response_model=list[schemas.SeasonalLeaderboardRead])
def list_seasonal_leaderboard(
    season_id: str = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    query = select(models.SeasonalLeaderboard)
    if season_id:
        query = query.where(models.SeasonalLeaderboard.season_id == season_id)
    query = query.order_by(desc(models.SeasonalLeaderboard.total_points)).limit(limit)
    return db.execute(query).scalars().all()


@router.get("/leaderboard/{leaderboard_id}", response_model=schemas.SeasonalLeaderboardRead)
def get_seasonal_leaderboard_entry(
    leaderboard_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    entry = db.get(models.SeasonalLeaderboard, leaderboard_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal leaderboard entry not found")
    return entry


@router.post("/leaderboard", response_model=schemas.SeasonalLeaderboardRead, status_code=status.HTTP_201_CREATED)
def create_seasonal_leaderboard_entry(
    payload: schemas.SeasonalLeaderboardCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    entry = models.SeasonalLeaderboard(
        season_id=payload.season_id,
        user_id=payload.user_id,
        total_points=payload.total_points,
        rank=payload.rank,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/leaderboard/{leaderboard_id}", response_model=schemas.SeasonalLeaderboardRead)
def update_seasonal_leaderboard_entry(
    leaderboard_id: str,
    payload: schemas.SeasonalLeaderboardUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    entry = db.get(models.SeasonalLeaderboard, leaderboard_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal leaderboard entry not found")

    if payload.total_points is not None:
        entry.total_points = payload.total_points
    if payload.rank is not None:
        entry.rank = payload.rank

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/leaderboard/{leaderboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_seasonal_leaderboard_entry(
    leaderboard_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    entry = db.get(models.SeasonalLeaderboard, leaderboard_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seasonal leaderboard entry not found")
    db.delete(entry)
    db.commit()


@router.post("/distribute/{season_id}", response_model=dict)
def distribute_seasonal_rewards(
    season_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    """Manually trigger reward distribution for a season."""
    # Get season
    season = db.get(models.Season, season_id)
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    # Get active reward configs
    configs = db.execute(
        select(models.SeasonalRewardConfig).where(models.SeasonalRewardConfig.is_active == True)
    ).scalars().all()

    # Get leaderboard for the season
    leaderboard = db.execute(
        select(models.SeasonalLeaderboard)
        .where(models.SeasonalLeaderboard.season_id == season_id)
        .order_by(desc(models.SeasonalLeaderboard.total_points))
    ).scalars().all()

    total_distributed = 0
    recipients = 0

    for config in configs:
        # Find eligible users based on points
        eligible_users = [entry for entry in leaderboard if entry.total_points >= config.points_required]

        # Apply max recipients limit if set
        if config.max_recipients:
            eligible_users = eligible_users[:config.max_recipients]

        for entry in eligible_users:
            # Create reward distribution record
            distribution = models.RewardDistribution(
                season_id=season_id,
                reward_type=config.reward_type,
                period_start=season.start_date,
                period_end=season.end_date,
                total_recipients=1,
                total_rewards=1,
                status="completed",
                details=f"Distributed {config.name} to {entry.user.name}",
            )
            db.add(distribution)
            recipients += 1
            total_distributed += 1

    db.commit()

    return {
        "message": f"Distributed {total_distributed} rewards to {recipients} users for season {season.name}",
        "season_id": season_id,
        "total_distributed": total_distributed,
        "recipients": recipients,
    }
