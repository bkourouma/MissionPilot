"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import type { ContactCreation } from "@missionpilot/shared";
import { api } from "../../../../lib/api";
import {
  SAISIE_CONTACT_VIDE,
  saisieDepuisContact,
  validerContact,
  type ChampContact,
  type Contact,
  type SaisieContact,
} from "../../../../lib/clients";

interface FormulaireContactProps {
  saisieInitiale: SaisieContact;
  libelleEnvoi: string;
  envoyer: (charge: ContactCreation) => Promise<unknown>;
  onAnnuler: () => void;
  succes: string;
  onSucces: () => void;
  titre: string;
}

function FormulaireContact({
  saisieInitiale,
  libelleEnvoi,
  envoyer,
  onAnnuler,
  succes,
  onSucces,
  titre,
}: FormulaireContactProps) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState(saisieInitiale);
  const f = useFormulaire<ChampContact>();
  const maj = (k: Exclude<ChampContact, "principal">) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerContact(s, langue), envoyer, {
      succes,
      apres: onSucces,
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom", "Name")}
          name="nom"
          required
          maxLength={160}
          value={s.nom}
          onChange={maj("nom")}
          erreur={f.erreurs.nom}
          autoComplete="off"
        />
        <Champ
          libelle={t("Fonction", "Job title")}
          name="fonction"
          maxLength={120}
          value={s.fonction}
          onChange={maj("fonction")}
          erreur={f.erreurs.fonction}
          aide={t("Ex. Directeur administratif et financier.", "E.g. Chief financial officer.")}
        />
        <Champ
          libelle={t("Adresse e-mail", "Email address")}
          type="email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          value={s.email}
          onChange={maj("email")}
          erreur={f.erreurs.email}
        />
        <Champ
          libelle={t("Téléphone", "Phone")}
          type="tel"
          name="telephone"
          inputMode="tel"
          autoComplete="off"
          maxLength={40}
          value={s.telephone}
          onChange={maj("telephone")}
          erreur={f.erreurs.telephone}
          aide={t(
            "Avec l'indicatif, ex. +225 07 00 00 00 00.",
            "With the country code, e.g. +225 07 00 00 00 00.",
          )}
        />
      </div>
      <CaseACocher
        libelle={t("Contact principal", "Primary contact")}
        aide={t(
          "Un seul contact principal par client : cocher cette case retire ce statut aux autres.",
          "Only one primary contact per client: checking this box removes that status from the others.",
        )}
        checked={s.principal}
        onChange={(e) => setS((x) => ({ ...x, principal: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {libelleEnvoi}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

export function AjoutContact({ clientId }: { clientId: string }) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const [cle, setCle] = useState(0);
  const [annonce, setAnnonce] = useState<string | null>(null);
  if (!ouvert) {
    return (
      <div className="mp-pile">
        {annonce ? (
          <p role="status" className="mp-texte-succes">
            {annonce}
          </p>
        ) : null}
        <div>
          <Bouton
            variante="secondaire"
            icone="plus"
            onClick={() => {
              setAnnonce(null);
              setOuvert(true);
            }}
          >
            {t("Ajouter un contact", "Add a contact")}
          </Bouton>
        </div>
      </div>
    );
  }
  return (
    <Carte titre={t("Nouveau contact", "New contact")} niveauTitre={3}>
      <FormulaireContact
        key={cle}
        titre={t("Nouveau contact", "New contact")}
        saisieInitiale={SAISIE_CONTACT_VIDE}
        libelleEnvoi={t("Ajouter le contact", "Add the contact")}
        succes={t("Contact ajouté.", "Contact added.")}
        envoyer={(c) => api.post(`/api/clients/${encodeURIComponent(clientId)}/contacts`, c)}
        onAnnuler={() => setOuvert(false)}
        onSucces={() => {
          setCle((k) => k + 1);
          setAnnonce(t("Contact ajouté.", "Contact added."));
          setOuvert(false);
        }}
      />
    </Carte>
  );
}

export function ContactModifiable({
  clientId,
  contact,
  peutEcrire,
}: {
  clientId: string;
  contact: Contact;
  peutEcrire: boolean;
}) {
  const t = useT();
  const [edition, setEdition] = useState(false);
  const suppression = useFormulaire<never>();
  const chemin = `/api/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.id)}`;

  return (
    <Carte
      niveauTitre={3}
      titre={contact.nom}
      actions={
        contact.principal ? (
          <BadgeStatut tonalite="succes">{t("Contact principal", "Primary contact")}</BadgeStatut>
        ) : null
      }
    >
      {edition ? (
        <FormulaireContact
          titre={`${t("Modifier", "Edit")} ${contact.nom}`}
          saisieInitiale={saisieDepuisContact(contact)}
          libelleEnvoi={t("Enregistrer", "Save")}
          succes={t("Contact modifié.", "Contact updated.")}
          envoyer={(c) => api.patch(chemin, c)}
          onAnnuler={() => setEdition(false)}
          onSucces={() => setEdition(false)}
        />
      ) : (
        <div className="mp-pile">
          <dl className="mp-liste-def mp-liste-def--compacte">
            <div>
              <dt>{t("Fonction", "Job title")}</dt>
              <dd>{contact.fonction ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("E-mail", "Email")}</dt>
              <dd>
                {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Téléphone", "Phone")}</dt>
              <dd>
                {contact.telephone ? (
                  <a href={`tel:${contact.telephone.replace(/[^+0-9]/g, "")}`}>
                    {contact.telephone}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          {peutEcrire ? (
            <>
              <RetourFormulaire
                erreur={suppression.erreurGlobale}
                refAlerte={suppression.refAlerte}
                titreErreur={t("Suppression impossible", "Deletion failed")}
              />
              <div className="mp-barre-actions">
                <Bouton
                  variante="secondaire"
                  icone="crayon"
                  onClick={() => setEdition(true)}
                  aria-label={t(
                    `Modifier le contact ${contact.nom}`,
                    `Edit contact ${contact.nom}`,
                  )}
                >
                  {t("Modifier", "Edit")}
                </Bouton>
                <BoutonConfirmation
                  libelle={t("Supprimer", "Delete")}
                  icone="corbeille"
                  ariaLabel={t(
                    `Supprimer le contact ${contact.nom}`,
                    `Delete contact ${contact.nom}`,
                  )}
                  question={t(
                    `Supprimer le contact ${contact.nom} ?`,
                    `Delete contact ${contact.nom}?`,
                  )}
                  libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
                  texteChargement={t("Suppression…", "Deleting…")}
                  action={() =>
                    suppression.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))
                  }
                />
              </div>
            </>
          ) : null}
        </div>
      )}
    </Carte>
  );
}
