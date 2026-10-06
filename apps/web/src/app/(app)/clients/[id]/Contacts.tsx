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
  const [s, setS] = useState(saisieInitiale);
  const f = useFormulaire<ChampContact>();
  const maj = (k: Exclude<ChampContact, "principal">) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerContact(s), envoyer, {
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
          libelle="Nom"
          name="nom"
          required
          maxLength={160}
          value={s.nom}
          onChange={maj("nom")}
          erreur={f.erreurs.nom}
          autoComplete="off"
        />
        <Champ
          libelle="Fonction"
          name="fonction"
          maxLength={120}
          value={s.fonction}
          onChange={maj("fonction")}
          erreur={f.erreurs.fonction}
          aide="Ex. Directeur administratif et financier."
        />
        <Champ
          libelle="Adresse e-mail"
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
          libelle="Téléphone"
          type="tel"
          name="telephone"
          inputMode="tel"
          autoComplete="off"
          maxLength={40}
          value={s.telephone}
          onChange={maj("telephone")}
          erreur={f.erreurs.telephone}
          aide="Avec l'indicatif, ex. +225 07 00 00 00 00."
        />
      </div>
      <CaseACocher
        libelle="Contact principal"
        aide="Un seul contact principal par client : cocher cette case retire ce statut aux autres."
        checked={s.principal}
        onChange={(e) => setS((x) => ({ ...x, principal: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {libelleEnvoi}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

export function AjoutContact({ clientId }: { clientId: string }) {
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
            Ajouter un contact
          </Bouton>
        </div>
      </div>
    );
  }
  return (
    <Carte titre="Nouveau contact" niveauTitre={3}>
      <FormulaireContact
        key={cle}
        titre="Nouveau contact"
        saisieInitiale={SAISIE_CONTACT_VIDE}
        libelleEnvoi="Ajouter le contact"
        succes="Contact ajouté."
        envoyer={(c) => api.post(`/api/clients/${encodeURIComponent(clientId)}/contacts`, c)}
        onAnnuler={() => setOuvert(false)}
        onSucces={() => {
          setCle((k) => k + 1);
          setAnnonce("Contact ajouté.");
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
  const [edition, setEdition] = useState(false);
  const suppression = useFormulaire<never>();
  const chemin = `/api/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.id)}`;

  return (
    <Carte
      niveauTitre={3}
      titre={contact.nom}
      actions={
        contact.principal ? <BadgeStatut tonalite="succes">Contact principal</BadgeStatut> : null
      }
    >
      {edition ? (
        <FormulaireContact
          titre={`Modifier ${contact.nom}`}
          saisieInitiale={saisieDepuisContact(contact)}
          libelleEnvoi="Enregistrer"
          succes="Contact modifié."
          envoyer={(c) => api.patch(chemin, c)}
          onAnnuler={() => setEdition(false)}
          onSucces={() => setEdition(false)}
        />
      ) : (
        <div className="mp-pile">
          <dl className="mp-liste-def mp-liste-def--compacte">
            <div>
              <dt>Fonction</dt>
              <dd>{contact.fonction ?? "—"}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>
                {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "—"}
              </dd>
            </div>
            <div>
              <dt>Téléphone</dt>
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
                titreErreur="Suppression impossible"
              />
              <div className="mp-barre-actions">
                <Bouton
                  variante="secondaire"
                  icone="crayon"
                  onClick={() => setEdition(true)}
                  aria-label={`Modifier le contact ${contact.nom}`}
                >
                  Modifier
                </Bouton>
                <BoutonConfirmation
                  libelle="Supprimer"
                  icone="corbeille"
                  ariaLabel={`Supprimer le contact ${contact.nom}`}
                  question={`Supprimer le contact ${contact.nom} ?`}
                  libelleConfirmation="Oui, supprimer"
                  texteChargement="Suppression…"
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
