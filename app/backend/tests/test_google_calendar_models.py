def test_user_has_email_column():
    from app.models.user import User
    assert hasattr(User, 'email')


def test_lead_has_google_calendar_event_id_column():
    from app.models.lead import Lead
    assert hasattr(Lead, 'google_calendar_event_id')


def test_lead_has_appointment_time_slot_column():
    from app.models.lead import Lead
    assert hasattr(Lead, 'appointment_time_slot')
